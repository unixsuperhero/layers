# frozen_string_literal: true

require 'json'
require_relative "../app/models/wholesale_order_request"
require_relative "../app/support/order_application"
require_relative "../app/models/account"
require_relative "../app/models/book"
require_relative "../app/models/order"
require_relative "../app/services/submit_wholesale_order_service"

request = WholesaleOrderRequest.new(
  account_number: " b-100 ",
  line_items: [
    { sku: "bk-101", quantity: 12 },
    { sku: " BK-202 ", quantity: 10 },
  ],
  destination: {
    street: "612 East Liberty Street",
    city: "Ann Arbor",
    state: " mi ",
    postal_code: " 48104 ",
  },
  delivery_speed: " expedited ",
  requested_by: " BUYER@BORDERS.COM ",
  submitted_at: "2010-08-03T09:30:00-04:00",
)

result = SubmitWholesaleOrderService.call(request: request)
raise "account seed is missing" unless Account.all.length == 1
raise "book seed is missing" unless Book.all.length == 2
raise "stock was not saved" unless Book.find("BK-101").stock == 28
raise "order was not saved" unless Order.all.length == 1

raise "wrong total" unless result.fetch(:total) == "$315.96"

puts JSON.pretty_generate result
