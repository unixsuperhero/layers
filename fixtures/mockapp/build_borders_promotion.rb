# frozen_string_literal: true

require "date"
require_relative "../app/models/merchant_catalog"
require_relative "../app/models/promotion_brief"
require_relative "../app/services/build_promotion_package_service"

merchant_catalog = MerchantCatalog.new(
  catalog_number: "BK-88",
  merchant_name: "  Borders Group, Incorporated ",
  stores: [
    { code: " a01 ", city: "ann arbor", participating: true, display_capacity: 2 },
    { code: "d14", city: "detroit", participating: false, display_capacity: 3 },
  ],
  books: [
    { title: "  The Left Hand of Darkness ", genre: "Science Fiction", stock: 12, price_cents: 1_599 },
    { title: "Kindred", genre: " science fiction ", stock: 8, price_cents: 1_499 },
    { title: "A Cook's Tour", genre: "Travel", stock: 20, price_cents: 1_899 },
  ],
  subscribers: [
    { email: " READER@EXAMPLE.COM ", email_opt_in: true, favorite_genres: ["Science Fiction"] },
    { email: "reader@example.com", email_opt_in: true, favorite_genres: ["science fiction"] },
    { email: "quiet@example.com", email_opt_in: false, favorite_genres: ["science fiction"] },
  ],
)

promotion_brief = PromotionBrief.new(
  starts_on: Date.new(2010, 10, 1),
  ends_on: Date.new(2010, 10, 7),
  genres: [" Science Fiction ", "science fiction"],
  discount_percent: 25,
  minimum_stock: 5,
)

result = BuildPromotionPackageService.new(
  merchant_catalog: merchant_catalog,
  promotion_brief: promotion_brief,
).call

raise "wrong campaign code" unless result.fetch(:code) == "BORDERS-20101001"
raise "wrong recipient list" unless result.fetch(:recipients) == ["reader@example.com"]
raise "campaign was not retained" unless merchant_catalog.campaigns == [result]

puts result
