# frozen_string_literal: true

Shop = Struct.new(:label, :city, :status, :closed_on) do
  def self.create(*args, **kwargs)
    if kwargs.count > 0
      return new(**kwargs)
    end

    case args.first
    when self
      self
    when Hash 
      args.map{|arg| new(**arg) }
    when Array
      args.map{|arg| new(*arg) }
    else
      new(*args)
    end
  end
end

