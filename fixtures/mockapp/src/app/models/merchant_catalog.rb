# frozen_string_literal: true

class MerchantCatalog
  attr_accessor :merchant_name, :campaigns
  attr_reader :catalog_number, :stores, :books, :subscribers

  def initialize(catalog_number:, merchant_name:, stores:, books:, subscribers:, campaigns: [])
    @catalog_number = catalog_number
    @merchant_name = merchant_name
    @stores = stores
    @books = books
    @subscribers = subscribers
    @campaigns = campaigns
  end
end
