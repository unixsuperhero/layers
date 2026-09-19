# frozen_string_literal: true

class Order < MemoryRecord
  def self.table_name
    :orders
  end

  def self.primary_key
    :number
  end

  def initialize(attributes = {})
    attributes = attributes.merge(number: MEMORY_STORE.next_order_number) unless attributes.key?(:number)
    super(attributes)
  end
end
