# frozen_string_literal: true

require "pry"
require "date"
require "prettyprint"
require_relative "../app/models/charge"
require_relative "../app/models/shop"
require_relative "../app/models/contact"
require_relative "../app/models/company_account"
require_relative "../app/models/wind_down_notice"
require_relative "../app/services/close_company_account_service"

begin
company_account = CompanyAccount.create(
  account_number: "C-1042",
  company_name: "  Borders Group, Incorporated  ",
  status: "active",
  credit_cents: 12_500,
  shops: [
    { label: "  Store 001 ", city: "ann arbor", status: "open" },
    { label: "Store 002", city: "dearborn", status: "already_closed" },
  ],
  contacts: [
    { name: "Archive Desk", email: " RECORDS@BORDERS.COM " },
    { name: "Duplicate", email: "records@borders.com" },
  ],
  charges: [
    { description: " Final storage invoice ", amount_cents: 30_000, state: "open" },
    { description: "Old settled invoice", amount_cents: 8_000, state: "paid" },
  ],
)

wind_down_notice = WindDownNotice.new(
  effective_on: Date.new(2011, 9, 18),
  reason: "chapter 7 liquidation",
  requested_by: " ARCHIVE@BORDERS.COM ",
  record_retention_years: 5,
)

result = CloseCompanyAccountService.new(
  company_account: company_account,
  wind_down_notice: wind_down_notice,
).call
rescue => e
  binding.pry
end

raise "account was not closed" unless company_account.status == "closed"
raise "wrong write-off" unless result.fetch(:final_write_off) == "$175.00"
raise "wrong archive" unless result.fetch(:archive_reference) == "borders-liquidation-2011"

pp result
