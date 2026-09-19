# frozen_string_literal: true

require "date"

class BuildPromotionPackageService
  def initialize(merchant_catalog:, promotion_brief:)
    @merchant_catalog = merchant_catalog
    @promotion_brief = promotion_brief
  end

  def call
    merchant_name = @merchant_catalog.merchant_name.to_s.strip
    merchant_name.gsub!(/\s+/, " ")
    merchant_name.sub!("Incorporated", "Inc.")

    starts_on = Date.parse(@promotion_brief.starts_on.to_s)
    ends_on = Date.parse(@promotion_brief.ends_on.to_s)
    campaign_days = (ends_on - starts_on).to_i + 1

    genres = @promotion_brief.genres.map(&:to_s)
    genres.map!(&:strip)
    genres.map!(&:downcase)
    genres.reject!(&:empty?)
    genres.uniq!

    discount_percent = @promotion_brief.discount_percent.to_i
    discount_percent = 5 if discount_percent < 5
    discount_percent = 40 if discount_percent > 40
    discount_multiplier = (100 - discount_percent) / 100.0

    subscribers = @merchant_catalog.subscribers.map(&:dup)
    subscribers.select! { |subscriber| subscriber.fetch(:email_opt_in) }
    subscribers.map! do |subscriber|
      subscriber[:email] = subscriber.fetch(:email).to_s.strip.downcase
      subscriber[:favorite_genres] = subscriber.fetch(:favorite_genres).map { |genre| genre.to_s.strip.downcase }
      subscriber
    end
    subscribers.reject! { |subscriber| subscriber.fetch(:email).empty? }
    subscribers.select! do |subscriber|
      (subscriber.fetch(:favorite_genres) & genres).any?
    end
    recipient_emails = subscribers.map { |subscriber| subscriber.fetch(:email) }
    recipient_emails.uniq!
    recipient_emails.sort!

    books = @merchant_catalog.books.map(&:dup)
    books.each do |book|
      book[:title] = book.fetch(:title).to_s.strip.gsub(/\s+/, " ")
      book[:genre] = book.fetch(:genre).to_s.strip.downcase
      book[:stock] = book.fetch(:stock).to_i
      book[:price_cents] = book.fetch(:price_cents).to_i
    end
    books.select! { |book| genres.include?(book.fetch(:genre)) }
    books.select! { |book| book.fetch(:stock) >= @promotion_brief.minimum_stock.to_i }
    books.each do |book|
      book[:sale_price_cents] = (book.fetch(:price_cents) * discount_multiplier).round
      book[:savings_cents] = book.fetch(:price_cents) - book.fetch(:sale_price_cents)
    end
    books.sort_by! { |book| [-book.fetch(:stock), book.fetch(:title)] }

    stores = @merchant_catalog.stores.map(&:dup)
    stores.select! { |store| store.fetch(:participating) }
    stores.each do |store|
      store[:code] = store.fetch(:code).to_s.strip.upcase
      store[:city] = store.fetch(:city).to_s.strip.split.map(&:capitalize).join(" ")
      store[:featured_titles] = books.first(store.fetch(:display_capacity).to_i).map { |book| book.fetch(:title) }
    end
    stores.sort_by! { |store| store.fetch(:code) }

    campaign_code = "#{merchant_name.downcase.gsub(/[^a-z0-9]+/, "-")}-#{starts_on.strftime("%Y%m%d")}"
    headline = "#{discount_percent}% off selected books"
    if merchant_name == "Borders Group, Inc."
      campaign_code = "BORDERS-#{starts_on.strftime("%Y%m%d")}"
      headline = "Borders Reader Picks: #{discount_percent}% Off"
    end

    projected_units = books.sum { |book| [book.fetch(:stock), campaign_days * 3].min }
    projected_revenue_cents = books.sum do |book|
      [book.fetch(:stock), campaign_days * 3].min * book.fetch(:sale_price_cents)
    end

    campaign = {
      code: campaign_code,
      headline: headline,
      merchant_name: merchant_name,
      starts_on: starts_on,
      ends_on: ends_on,
      genres: genres,
      recipients: recipient_emails,
      stores: stores,
      books: books,
      projected_units: projected_units,
      projected_revenue: money(projected_revenue_cents),
    }

    @merchant_catalog.merchant_name = merchant_name
    @merchant_catalog.campaigns << campaign

    campaign
  end

  private

  def money(cents)
    format("$%.2f", cents / 100.0)
  end
end
