# Invoice — café billing ☕ (multibyte on purpose)
class Invoice
  attr_reader :items

  def initialize(items)
    @items = items
  end

  def summary
    total = 0
    items.each do |item|
      total += item
    end
    label = "Total"
    "#{label}: #{total}"
  end

  def overdue?
    summary.length > 10
  end
end
