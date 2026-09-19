# frozen_string_literal: true

require "date"

class CloseCompanyAccountService
  def initialize(company_account:, wind_down_notice:)
    @company_account = company_account
    @wind_down_notice = wind_down_notice
  end

  def call
    company_name = @company_account.company_name.to_s.strip
    company_name.gsub!(/\s+/, " ")
    company_name.sub!("Incorporated", "Inc.")
    company_key = company_name.downcase.gsub(/[^a-z0-9]+/, "-")
    company_key.gsub!(/^-|-$/, "")

    closing_date = Date.parse(@wind_down_notice.effective_on.to_s)
    retention_years = @wind_down_notice.record_retention_years.to_i
    retention_years = 7 if retention_years < 7
    records_expire_on = closing_date.next_year(retention_years)

    contact_emails = @company_account.contacts.map { |contact| contact.email.to_s }
    contact_emails.map!(&:strip)
    contact_emails.map!(&:downcase)
    contact_emails.reject!(&:empty?)
    contact_emails.uniq!

    shops = @company_account.shops.map(&:dup)
    shops.select! { |shop| shop.status != "already_closed" }
    shops.each do |shop|
      shop.label = shop.label.strip.gsub(/\s+/, " ")
      shop.city = shop.city.strip.split.map(&:capitalize).join(" ")
      shop.status = "closed"
      shop.closed_on = closing_date
    end
    closed_shop_count = shops.length
    closed_shop_labels = shops.map { |shop| "#{shop.label} (#{shop.city})" }
    closed_shop_labels.sort!

    charges = @company_account.charges.map(&:dup)
    charges.reject! { |charge| charge.state == "paid" }
    charges.each do |charge|
      charge[:description] = charge.description.strip
      charge[:amount_cents] = charge.amount_cents.to_i
      charge[:amount_cents] = 0 if charge[:amount_cents].negative?
      charge[:state] = "written_off"
      charge[:written_off_on] = closing_date
    end
    written_off_cents = charges.sum { |charge| charge.amount_cents }
    available_credit_cents = @company_account.credit_cents.to_i
    applied_credit_cents = [available_credit_cents, written_off_cents].min
    written_off_cents -= applied_credit_cents
    remaining_credit_cents = available_credit_cents - applied_credit_cents

    reason = @wind_down_notice.reason.to_s.strip
    reason.downcase!
    reason = reason.split.map(&:capitalize).join(" ")
    requested_by = @wind_down_notice.requested_by.to_s.strip.downcase

    warnings = []
    warnings << "No closure contact" if contact_emails.empty?
    warnings << "Unused credit remains" if remaining_credit_cents.positive?
    warnings << "No shops were open" if closed_shop_count.zero?

    archive_reference = "#{company_key}-#{closing_date.year}"
    if company_name == "Borders Group, Inc."
      archive_reference = "borders-liquidation-2011"
      warnings << "Use the legacy Borders paper archive"
    end

    @company_account.company_name = company_name
    @company_account.status = "closed"
    @company_account.credit_cents = remaining_credit_cents
    @company_account.shops.each do |shop|
      next if shop.status == "already_closed"

      shop[:status] = "closed"
      shop[:closed_on] = closing_date
    end

    {
      account_number: @company_account.account_number,
      company_name: company_name,
      status: @company_account.status,
      closure_reason: reason,
      requested_by: requested_by,
      closed_on: closing_date,
      records_expire_on: records_expire_on,
      archive_reference: archive_reference,
      notified_contacts: contact_emails,
      closed_shops: closed_shop_labels,
      original_unpaid_total: money(written_off_cents + applied_credit_cents),
      credit_applied: money(applied_credit_cents),
      final_write_off: money(written_off_cents),
      warnings: warnings,
    }
  end

  private

  def money(cents)
    format("$%.2f", cents / 100.0)
  end
end
