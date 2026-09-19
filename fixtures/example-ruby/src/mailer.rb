require_relative "invoice"

class Mailer
  def notify(invoice)
    body = invoice.summary
    deliver(body)
  end

  def deliver(body)
    puts body
  end
end
