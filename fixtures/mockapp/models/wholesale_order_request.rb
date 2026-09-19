# frozen_string_literal: true

class WholesaleOrderRequest
  attr_reader :account_number, :line_items, :destination, :delivery_speed, :requested_by, :submitted_at

  def initialize(account_number:, line_items:, destination:, delivery_speed:, requested_by:, submitted_at:)
    @account_number = account_number
    @line_items = line_items
    @destination = destination
    @delivery_speed = delivery_speed
    @requested_by = requested_by
    @submitted_at = submitted_at
  end
end
