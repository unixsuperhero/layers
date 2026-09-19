# frozen_string_literal: true

class Account < MemoryRecord
  def self.table_name
    :accounts
  end

  def self.primary_key
    :account_number
  end
end
