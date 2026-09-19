# frozen_string_literal: true

class RouteBook
  attr_accessor :company_name, :quotes
  attr_reader :book_number, :routes, :travelers

  def initialize(book_number:, company_name:, routes:, travelers:, quotes: [])
    @book_number = book_number
    @company_name = company_name
    @routes = routes
    @travelers = travelers
    @quotes = quotes
  end
end
