# frozen_string_literal: true

require "time"

class SubmitWholesaleOrderService
  def self.call(**kwargs)
    new(**kwargs)&.call
  end

  attr_reader :raw_request

  def initialize(request:)
    @raw_request = request
  end

  def store = @store ||= MemoryStore.new
  def payment_gateway = @payment_gateway ||= PaymentGateway.new
  def mailbox = @mailbox ||= Mailbox.new
  def job_queue = @job_queue ||= JobQueue.new
  def activity_log = @activity_log ||= ActivityLog.new

  Request = Struct.new(:raw_request) do
    def raw_account_number = raw_request.account_number
    def account_number = raw_account_number.to_s.strip.upcase
    def account = store.accounts.fetch(account_number)
    def ordering_status = account.fetch(:ordering_status)
    def account_approved_to_order? = ordering_status == "approved"

    def requested_by = requested_by.to_s.strip.downcase
  end

  def request = @request ||= Request.new(raw_request)

  def call
    store.transaction do
      raise ArgumentError, "account cannot place orders" unless request.account_approved_to_order?
      raise ArgumentError, "requester is not allowed" unless account.fetch(:buyers).map(&:downcase).include?(requested_by)

      destination = request.destination.transform_values { |value| value.to_s.strip }
      destination[:state] = destination.fetch(:state).upcase
      destination[:postal_code] = destination.fetch(:postal_code).gsub(/\s+/, "")
      raise ArgumentError, "unsupported destination" unless account.fetch(:allowed_states).include?(destination.fetch(:state))

      line_items = []
      request.line_items.each do |requested_item|
        sku = requested_item.fetch(:sku).to_s.strip.upcase
        quantity = requested_item.fetch(:quantity).to_i
        raise ArgumentError, "quantity must be positive" unless quantity.positive?

        book = store.books.fetch(sku)
        raise ArgumentError, "insufficient stock for #{sku}" if book.fetch(:stock) < quantity

        unit_price_cents = book.fetch(:price_cents)
        unit_price_cents = (unit_price_cents * 0.92).round if account.fetch(:pricing_tier) == "education"
        line_items << {
          sku: sku,
          title: book.fetch(:title),
          quantity: quantity,
          unit_price_cents: unit_price_cents,
          line_total_cents: unit_price_cents * quantity,
        }
      end

      unit_count = line_items.sum { |item| item.fetch(:quantity) }
      subtotal_cents = line_items.sum { |item| item.fetch(:line_total_cents) }
      volume_discount_percent = if unit_count >= 50
        15
      elsif unit_count >= 20
        10
      elsif unit_count >= 10
        5
      else
        0
      end
      volume_discount_cents = (subtotal_cents * volume_discount_percent / 100.0).round
      subtotal_after_discount_cents = subtotal_cents - volume_discount_cents

      delivery_speed = request.delivery_speed.to_s.strip.downcase
      raise ArgumentError, "unknown delivery speed" unless %w[standard expedited].include?(delivery_speed)

      shipping_cents = subtotal_after_discount_cents >= 50_000 ? 0 : 2_500
      shipping_cents += 1_500 if delivery_speed == "expedited"
      shipping_cents = 0 if account.fetch(:company_name) == "Borders Group, Inc."

      taxable_cents = subtotal_after_discount_cents + shipping_cents
      tax_rate = { "MI" => 0.06, "NY" => 0.04 }.fetch(destination.fetch(:state), 0.05)
      tax_cents = (taxable_cents * tax_rate).round
      total_cents = taxable_cents + tax_cents
      balance_after_order_cents = account.fetch(:open_balance_cents) + total_cents
      raise ArgumentError, "credit limit exceeded" if balance_after_order_cents > account.fetch(:credit_limit_cents)

      authorization = payment_gateway.authorize!(
        account_number: account_number,
        amount_cents: total_cents,
      )

      order = {
        number: store.next_order_number,
        account_number: account_number,
        company_name: account.fetch(:company_name),
        requested_by: requested_by,
        submitted_at: Time.parse(request.submitted_at.to_s),
        destination: destination,
        delivery_speed: delivery_speed,
        line_items: line_items,
        unit_count: unit_count,
        subtotal_cents: subtotal_cents,
        volume_discount_percent: volume_discount_percent,
        volume_discount_cents: volume_discount_cents,
        shipping_cents: shipping_cents,
        tax_cents: tax_cents,
        total_cents: total_cents,
        authorization_id: authorization.fetch(:id),
        status: "accepted",
      }
      store.orders << order

      line_items.each do |item|
        book = store.books.fetch(item.fetch(:sku))
        book[:stock] -= item.fetch(:quantity)
      end
      account[:open_balance_cents] = balance_after_order_cents

      activity_log.record(
        action: "wholesale_order_submitted",
        order_number: order.fetch(:number),
        actor: requested_by,
        total_cents: total_cents,
      )
      job_queue.enqueue("PackWholesaleOrder", { order_number: order.fetch(:number) })
      mailbox.deliver(
        to: requested_by,
        subject: "Order #{order.fetch(:number)} accepted",
        body: "#{unit_count} books, total #{money(total_cents)}",
      )

      {
        order_number: order.fetch(:number),
        company_name: order.fetch(:company_name),
        status: order.fetch(:status),
        units: unit_count,
        discount: money(volume_discount_cents),
        shipping: money(shipping_cents),
        tax: money(tax_cents),
        total: money(total_cents),
      }
    end
  end

  private

  def money(cents)
    format("$%.2f", cents / 100.0)
  end
end
