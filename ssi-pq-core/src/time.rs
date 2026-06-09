use chrono::{DateTime, FixedOffset};

/// Analisa timestamps externos aceitos pelo core.
pub(crate) fn parse_rfc3339_timestamp(
    field: &str,
    value: &str,
) -> std::result::Result<DateTime<FixedOffset>, String> {
    DateTime::parse_from_rfc3339(value)
        .map_err(|error| format!("{field} must be a valid RFC 3339 timestamp: {error}"))
}

/// Valida um timestamp RFC 3339 sem normalizar sua representação textual.
pub(crate) fn validate_rfc3339_timestamp(
    field: &str,
    value: &str,
) -> std::result::Result<(), String> {
    parse_rfc3339_timestamp(field, value).map(|_| ())
}
