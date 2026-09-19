require_relative "invoice"
require_relative "mailer"

invoice = Invoice.new([10, 32])
Mailer.new.notify(invoice)
