# frozen_string_literal: true

class TripBrief
  attr_reader :origin, :destination, :departure_on, :cabin, :meal_codes, :group_discount_percent

  def initialize(origin:, destination:, departure_on:, cabin:, meal_codes:, group_discount_percent:)
    @origin = origin
    @destination = destination
    @departure_on = departure_on
    @cabin = cabin
    @meal_codes = meal_codes
    @group_discount_percent = group_discount_percent
  end
end
