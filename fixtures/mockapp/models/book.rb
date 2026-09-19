# frozen_string_literal: true

class Book < MemoryRecord
  def self.table_name
    :books
  end

  def self.primary_key
    :sku
  end
end
