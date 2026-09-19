# frozen_string_literal: true

class PromotionBrief
  attr_reader :starts_on, :ends_on, :genres, :discount_percent, :minimum_stock

  def initialize(starts_on:, ends_on:, genres:, discount_percent:, minimum_stock:)
    @starts_on = starts_on
    @ends_on = ends_on
    @genres = genres
    @discount_percent = discount_percent
    @minimum_stock = minimum_stock
  end
end
