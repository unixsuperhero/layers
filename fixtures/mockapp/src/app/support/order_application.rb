# frozen_string_literal: true

class MemoryStore
  attr_reader :tables

  def initialize
    @tables = {
      accounts: {
        "B-100" => {
          account_number: "B-100",
          company_name: "Borders Group, Inc.",
          ordering_status: "approved",
          pricing_tier: "education",
          buyers: ["buyer@borders.com"],
          allowed_states: ["MI", "NY"],
          open_balance_cents: 25_000,
          credit_limit_cents: 250_000,
        },
      },
      books: {
        "BK-101" => { sku: "BK-101", title: "Kindred", price_cents: 1_500, stock: 40 },
        "BK-202" => { sku: "BK-202", title: "The Dispossessed", price_cents: 1_800, stock: 30 },
      },
      orders: {},
    }
    @next_order_number = 1
  end

  def transaction
    snapshot = Marshal.dump([@tables, @next_order_number])
    yield
  rescue StandardError
    @tables, @next_order_number = Marshal.load(snapshot)
    raise
  end

  def next_order_number
    number = format("W-%04d", @next_order_number)
    @next_order_number += 1
    number
  end
end

MEMORY_STORE = MemoryStore.new

class MemoryRecord
  def self.all
    records.values.map { |attributes| new(attributes) }
  end

  def self.find(id)
    new(records.fetch(id))
  end

  def self.records
    MEMORY_STORE.tables.fetch(table_name)
  end

  def initialize(attributes = {})
    @attributes = attributes.dup
  end

  def save
    self.class.records[public_send(self.class.primary_key)] = @attributes.dup
    self
  end

  def method_missing(name, *args)
    method_name = name.to_s
    attribute = method_name.delete_suffix("=").to_sym

    if method_name.end_with?("=") && args.length == 1
      @attributes[attribute] = args.first
    elsif args.empty? && @attributes.key?(attribute)
      @attributes.fetch(attribute)
    else
      super
    end
  end

  def respond_to_missing?(name, include_private = false)
    attribute = name.to_s.delete_suffix("=").to_sym
    @attributes.key?(attribute) || super
  end
end

class PaymentGateway
  attr_reader :authorizations

  def initialize
    @authorizations = []
  end

  def authorize!(account_number:, amount_cents:)
    authorization = {
      id: "AUTH-#{@authorizations.length + 1}",
      account_number: account_number,
      amount_cents: amount_cents,
    }
    @authorizations << authorization
    authorization
  end
end

class Mailbox
  attr_reader :deliveries

  def initialize
    @deliveries = []
  end

  def deliver(message)
    @deliveries << message
  end
end

class JobQueue
  attr_reader :jobs

  def initialize
    @jobs = []
  end

  def enqueue(name, payload)
    @jobs << { name: name, payload: payload }
  end
end

class ActivityLog
  attr_reader :entries

  def initialize
    @entries = []
  end

  def record(entry)
    @entries << entry
  end
end
