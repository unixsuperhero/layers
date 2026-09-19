# frozen_string_literal: true

class WindDownNotice
  attr_reader :effective_on, :reason, :requested_by, :record_retention_years

  def initialize(effective_on:, reason:, requested_by:, record_retention_years:)
    @effective_on = effective_on
    @reason = reason
    @requested_by = requested_by
    @record_retention_years = record_retention_years
  end
end
