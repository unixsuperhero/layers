# frozen_string_literal: true

class CompanyAccount
  attr_accessor :company_name, :status, :credit_cents, :shops
  attr_reader :account_number, :contacts, :charges

  def self.create(**kwargs)
    kwargs[:shops] = Shop.create(*kwargs[:shops])
    kwargs[:contacts] = Contact.create(*kwargs[:contacts])
    kwargs[:charges] = Charge.create(*kwargs[:charges])
    new(**kwargs)
  end

  def initialize(account_number:, company_name:, status:, credit_cents:, shops:, contacts:, charges:)
    @account_number = account_number
    @company_name = company_name
    @status = status
    @credit_cents = credit_cents
    @shops = shops
    @contacts = contacts
    @charges = charges
  end
end
