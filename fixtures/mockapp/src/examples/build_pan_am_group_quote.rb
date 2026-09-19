# frozen_string_literal: true

require "date"
require_relative "../app/models/route_book"
require_relative "../app/models/trip_brief"
require_relative "../app/services/build_group_trip_quote_service"

route_book = RouteBook.new(
  book_number: "G-204",
  company_name: "  Pan American World Airways  ",
  routes: [
    { flight_number: " pa 101 ", origin: "jfk", destination: "lhr", departure_on: Date.new(1990, 6, 4), available_seats: 12, base_fare_cents: 42_500 },
    { flight_number: "pa 202", origin: "JFK", destination: "CDG", departure_on: Date.new(1990, 6, 4), available_seats: 20, base_fare_cents: 39_000 },
  ],
  travelers: [
    { first_name: " ada ", last_name: "lovelace", age: 36, meal_code: " vgml " },
    { first_name: "grace", last_name: " hopper ", age: 8, meal_code: "unknown" },
    { first_name: "mary", last_name: "jackson", age: 21, meal_code: "std" },
    { first_name: "katherine", last_name: "johnson", age: 22, meal_code: "VGML" },
    { first_name: "dorothy", last_name: "vaughan", age: 19, meal_code: "std" },
  ],
)

trip_brief = TripBrief.new(
  origin: " jfk ",
  destination: "lhr",
  departure_on: Date.new(1990, 6, 4),
  cabin: " Business ",
  meal_codes: ["STD", " vgml ", "VGML"],
  group_discount_percent: 10,
)

result = BuildGroupTripQuoteService.new(
  route_book: route_book,
  trip_brief: trip_brief,
).call

raise "wrong quote code" unless result.fetch(:code) == "PA-JFKLHR-900604"
raise "wrong traveler order" unless result.fetch(:travelers).first.fetch(:display_name) == "HOPPER, Grace"
raise "quote was not retained" unless route_book.quotes == [result]

puts result
