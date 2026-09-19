# frozen_string_literal: true

require "date"

class BuildGroupTripQuoteService
  def initialize(route_book:, trip_brief:)
    @route_book = route_book
    @trip_brief = trip_brief
  end

  def call
    company_name = @route_book.company_name.to_s.strip
    company_name.gsub!(/\s+/, " ")

    origin = @trip_brief.origin.to_s.strip.upcase
    destination = @trip_brief.destination.to_s.strip.upcase
    departure_on = Date.parse(@trip_brief.departure_on.to_s)
    cabin = @trip_brief.cabin.to_s.strip.downcase
    cabin = "economy" unless %w[economy business first].include?(cabin)

    meal_codes = @trip_brief.meal_codes.map(&:to_s)
    meal_codes.map!(&:strip)
    meal_codes.map!(&:upcase)
    meal_codes.reject!(&:empty?)
    meal_codes.uniq!

    travelers = @route_book.travelers.map(&:dup)
    travelers.each do |traveler|
      traveler[:first_name] = traveler.fetch(:first_name).to_s.strip.capitalize
      traveler[:last_name] = traveler.fetch(:last_name).to_s.strip.upcase
      traveler[:age] = traveler.fetch(:age).to_i
      traveler[:meal_code] = traveler.fetch(:meal_code, "").to_s.strip.upcase
      traveler[:meal_code] = "STD" unless meal_codes.include?(traveler[:meal_code])
      traveler[:display_name] = "#{traveler.fetch(:last_name)}, #{traveler.fetch(:first_name)}"
    end
    travelers.sort_by! { |traveler| [traveler.fetch(:last_name), traveler.fetch(:first_name)] }

    routes = @route_book.routes.map(&:dup)
    routes.each do |route|
      route[:origin] = route.fetch(:origin).to_s.strip.upcase
      route[:destination] = route.fetch(:destination).to_s.strip.upcase
      route[:flight_number] = route.fetch(:flight_number).to_s.strip.upcase
      route[:departure_on] = Date.parse(route.fetch(:departure_on).to_s)
      route[:available_seats] = route.fetch(:available_seats).to_i
      route[:base_fare_cents] = route.fetch(:base_fare_cents).to_i
    end
    routes.select! { |route| route.fetch(:origin) == origin }
    routes.select! { |route| route.fetch(:destination) == destination }
    routes.select! { |route| route.fetch(:departure_on) == departure_on }
    routes.select! { |route| route.fetch(:available_seats) >= travelers.length }
    routes.sort_by! { |route| [route.fetch(:base_fare_cents), route.fetch(:flight_number)] }

    selected_route = routes.first
    raise ArgumentError, "no matching route" unless selected_route

    cabin_multiplier = { "economy" => 1.0, "business" => 1.8, "first" => 2.6 }.fetch(cabin)
    fare_per_traveler_cents = (selected_route.fetch(:base_fare_cents) * cabin_multiplier).round
    subtotal_cents = travelers.length * fare_per_traveler_cents

    discount_percent = @trip_brief.group_discount_percent.to_i
    discount_percent = 0 if travelers.length < 5
    discount_percent = 20 if discount_percent > 20
    discount_cents = (subtotal_cents * discount_percent / 100.0).round
    subtotal_cents -= discount_cents

    child_count = travelers.count { |traveler| traveler.fetch(:age) < 12 }
    child_credit_cents = child_count * 2_500
    subtotal_cents -= child_credit_cents
    subtotal_cents = 0 if subtotal_cents.negative?

    taxes_cents = (subtotal_cents * 0.075).round
    total_cents = subtotal_cents + taxes_cents
    quote_code = "#{origin}-#{destination}-#{departure_on.strftime("%Y%m%d")}-#{@route_book.book_number}"
    service_note = "Group itinerary"

    if company_name == "Pan American World Airways"
      quote_code = "PA-#{origin}#{destination}-#{departure_on.strftime("%y%m%d")}"
      service_note = "Pan Am group itinerary"
    end

    quote = {
      code: quote_code,
      company_name: company_name,
      service_note: service_note,
      flight_number: selected_route.fetch(:flight_number),
      origin: origin,
      destination: destination,
      departure_on: departure_on,
      cabin: cabin,
      travelers: travelers,
      fare_per_traveler: money(fare_per_traveler_cents),
      discount: money(discount_cents),
      child_credit: money(child_credit_cents),
      taxes: money(taxes_cents),
      total: money(total_cents),
    }

    @route_book.company_name = company_name
    @route_book.quotes << quote
    selected_route[:available_seats] -= travelers.length

    quote
  end

  private

  def money(cents)
    format("$%.2f", cents / 100.0)
  end
end
