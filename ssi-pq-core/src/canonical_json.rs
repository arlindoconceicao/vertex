use serde::de::{self, DeserializeSeed, MapAccess, SeqAccess, Visitor};
use serde_json::{Number, Value};
use std::{cmp::Ordering, fmt, fs, path::Path};

use crate::errors::Result;

/// Converte uma string JSON para sua representação canônica RFC 8785/JCS.
///
/// A entrada é analisada como JSON e depois serializada com regras estáveis,
/// incluindo ordenação lexicográfica UTF-16 das chaves de objetos.
pub fn canonical_json_string_from_str(json: &str) -> Result<String> {
    let value = parse_json_without_duplicate_properties(json)?;
    Ok(canonical_json_string(&value))
}

/// Lê um arquivo JSON UTF-8 e retorna sua representação canônica RFC 8785/JCS.
pub fn canonical_json_string_from_file(path: impl AsRef<Path>) -> Result<String> {
    let json = fs::read_to_string(path)?;
    canonical_json_string_from_str(&json)
}

/// Serializa um valor JSON canônico como bytes UTF-8.
///
/// Use esta função quando a próxima etapa espera bytes, como hashing,
/// assinatura ou montagem de mensagens com separação de domínio.
pub fn canonical_json_bytes(value: &Value) -> Vec<u8> {
    canonical_json_string(value).into_bytes()
}

/// Serializa um valor JSON usando regras canônicas RFC 8785/JCS.
///
/// Objetos têm suas chaves ordenadas por unidades UTF-16, arrays preservam sua
/// ordem original e primitivos seguem a representação de `JSON.stringify()`.
pub fn canonical_json_string(value: &Value) -> String {
    let mut out = String::new();
    write_canonical_json(value, &mut out);
    out
}

/// Escreve recursivamente a representação canônica de um valor JSON.
fn write_canonical_json(value: &Value, out: &mut String) {
    match value {
        Value::Null => out.push_str("null"),
        Value::Bool(value) => out.push_str(if *value { "true" } else { "false" }),
        Value::Number(value) => write_ecmascript_number(value, out),
        Value::String(value) => write_ecmascript_string(value, out),
        Value::Array(values) => {
            out.push('[');
            for (index, item) in values.iter().enumerate() {
                if index > 0 {
                    out.push(',');
                }
                write_canonical_json(item, out);
            }
            out.push(']');
        }
        Value::Object(map) => {
            out.push('{');

            let mut entries = map.iter().collect::<Vec<_>>();
            entries.sort_by(|(left_key, _), (right_key, _)| compare_utf16(left_key, right_key));

            for (index, (key, value)) in entries.into_iter().enumerate() {
                if index > 0 {
                    out.push(',');
                }
                write_ecmascript_string(key, out);
                out.push(':');
                write_canonical_json(value, out);
            }

            out.push('}');
        }
    }
}

fn parse_json_without_duplicate_properties(json: &str) -> Result<Value> {
    let mut deserializer = serde_json::Deserializer::from_str(json);
    let value = DuplicateCheckingValue.deserialize(&mut deserializer)?;
    deserializer.end()?;
    Ok(value)
}

struct DuplicateCheckingValue;

impl<'de> DeserializeSeed<'de> for DuplicateCheckingValue {
    type Value = Value;

    fn deserialize<D>(self, deserializer: D) -> std::result::Result<Value, D::Error>
    where
        D: de::Deserializer<'de>,
    {
        deserializer.deserialize_any(DuplicateCheckingVisitor)
    }
}

struct DuplicateCheckingVisitor;

impl<'de> Visitor<'de> for DuplicateCheckingVisitor {
    type Value = Value;

    fn expecting(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("a JSON value without duplicate object property names")
    }

    fn visit_unit<E>(self) -> std::result::Result<Value, E>
    where
        E: de::Error,
    {
        Ok(Value::Null)
    }

    fn visit_bool<E>(self, value: bool) -> std::result::Result<Value, E>
    where
        E: de::Error,
    {
        Ok(Value::Bool(value))
    }

    fn visit_i64<E>(self, value: i64) -> std::result::Result<Value, E>
    where
        E: de::Error,
    {
        Ok(Value::Number(Number::from(value)))
    }

    fn visit_u64<E>(self, value: u64) -> std::result::Result<Value, E>
    where
        E: de::Error,
    {
        Ok(Value::Number(Number::from(value)))
    }

    fn visit_f64<E>(self, value: f64) -> std::result::Result<Value, E>
    where
        E: de::Error,
    {
        Number::from_f64(value)
            .map(Value::Number)
            .ok_or_else(|| E::custom("JSON numbers must be finite IEEE 754 values"))
    }

    fn visit_str<E>(self, value: &str) -> std::result::Result<Value, E>
    where
        E: de::Error,
    {
        Ok(Value::String(value.to_string()))
    }

    fn visit_string<E>(self, value: String) -> std::result::Result<Value, E>
    where
        E: de::Error,
    {
        Ok(Value::String(value))
    }

    fn visit_seq<A>(self, mut seq: A) -> std::result::Result<Value, A::Error>
    where
        A: SeqAccess<'de>,
    {
        let mut values = Vec::new();

        while let Some(value) = seq.next_element_seed(DuplicateCheckingValue)? {
            values.push(value);
        }

        Ok(Value::Array(values))
    }

    fn visit_map<A>(self, mut map: A) -> std::result::Result<Value, A::Error>
    where
        A: MapAccess<'de>,
    {
        let mut values = serde_json::Map::new();

        while let Some(key) = map.next_key::<String>()? {
            if values.contains_key(&key) {
                return Err(de::Error::custom(format!(
                    "duplicate JSON property name: {key}"
                )));
            }

            let value = map.next_value_seed(DuplicateCheckingValue)?;
            values.insert(key, value);
        }

        Ok(Value::Object(values))
    }
}

fn write_ecmascript_string(value: &str, out: &mut String) {
    out.push('"');

    for character in value.chars() {
        match character {
            '"' => out.push_str("\\\""),
            '\\' => out.push_str("\\\\"),
            '\u{08}' => out.push_str("\\b"),
            '\u{09}' => out.push_str("\\t"),
            '\u{0a}' => out.push_str("\\n"),
            '\u{0c}' => out.push_str("\\f"),
            '\u{0d}' => out.push_str("\\r"),
            '\u{00}'..='\u{1f}' => {
                out.push_str("\\u");
                out.push_str(&format!("{:04x}", character as u32));
            }
            _ => out.push(character),
        }
    }

    out.push('"');
}

fn write_ecmascript_number(value: &Number, out: &mut String) {
    let number = value
        .as_f64()
        .expect("serde_json numbers are finite IEEE 754-compatible values");
    out.push_str(&ecmascript_number_to_string(number));
}

fn ecmascript_number_to_string(number: f64) -> String {
    if number == 0.0 {
        return "0".to_string();
    }

    let sign = if number.is_sign_negative() { "-" } else { "" };
    let abs = number.abs();
    let mut buffer = ryu::Buffer::new();
    let raw = buffer.format_finite(abs);
    let (digits, decimal_exponent) = decompose_shortest_decimal(&raw);
    let k = digits.len() as i32;
    let n = decimal_exponent;

    let body = if k <= n && n <= 21 {
        format!("{}{}", digits, "0".repeat((n - k) as usize))
    } else if 0 < n && n <= 21 {
        let index = n as usize;
        format!("{}.{}", &digits[..index], &digits[index..])
    } else if -6 < n && n <= 0 {
        format!("0.{}{}", "0".repeat((-n) as usize), digits)
    } else {
        let exponent = n - 1;
        let exponent_sign = if exponent >= 0 { "+" } else { "" };
        if digits.len() == 1 {
            format!("{digits}e{exponent_sign}{exponent}")
        } else {
            format!(
                "{}.{}e{}{}",
                &digits[..1],
                &digits[1..],
                exponent_sign,
                exponent
            )
        }
    };

    format!("{sign}{body}")
}

fn decompose_shortest_decimal(raw: &str) -> (String, i32) {
    let (coefficient, exponent) = match raw.split_once('e') {
        Some((coefficient, exponent)) => (coefficient, exponent.parse::<i32>().unwrap()),
        None => (raw, 0),
    };

    let decimal_digits_before_point = coefficient
        .split_once('.')
        .map(|(before, _)| before.len())
        .unwrap_or(coefficient.len());
    let mut digits = coefficient
        .bytes()
        .filter(|byte| byte.is_ascii_digit())
        .collect::<Vec<_>>();

    let first_significant = digits
        .iter()
        .position(|digit| *digit != b'0')
        .expect("non-zero finite number must have a significant digit");
    let decimal_exponent =
        decimal_digits_before_point as i32 + exponent - first_significant as i32;

    digits.drain(..first_significant);
    while digits.last() == Some(&b'0') {
        digits.pop();
    }

    (
        String::from_utf8(digits).expect("decimal digits must be valid UTF-8"),
        decimal_exponent,
    )
}

fn compare_utf16(left: &str, right: &str) -> Ordering {
    left.encode_utf16().cmp(right.encode_utf16())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::SsiError;
    use serde_json::json;

    #[test]
    fn object_keys_are_sorted_recursively() {
        let value: Value = serde_json::from_str(r#"{"z":1,"a":{"b":2,"a":1}}"#).unwrap();

        assert_eq!(
            canonical_json_string(&value),
            r#"{"a":{"a":1,"b":2},"z":1}"#
        );
    }

    #[test]
    fn arrays_keep_their_original_order() {
        let value: Value = serde_json::from_str(r#"[{"b":2,"a":1},3]"#).unwrap();

        assert_eq!(canonical_json_string(&value), r#"[{"a":1,"b":2},3]"#);
    }

    #[test]
    fn matches_rfc_8785_primitive_sample() {
        let json = r#"{
            "numbers": [333333333.33333329, 1E30, 4.50, 2e-3, 0.000000000000000000000000001],
            "string": "\u20ac$\u000F\u000aA'\u0042\u0022\u005c\\\"\/",
            "literals": [null, true, false]
        }"#;

        assert_eq!(
            canonical_json_string_from_str(json).unwrap(),
            "{\"literals\":[null,true,false],\"numbers\":[333333333.3333333,1e+30,4.5,0.002,1e-27],\"string\":\"€$\\u000f\\nA'B\\\"\\\\\\\\\\\"/\"}"
        );
    }

    #[test]
    fn sorts_properties_using_utf16_code_units() {
        let json = r#"{
            "\u20ac": "Euro Sign",
            "\r": "Carriage Return",
            "\ufb33": "Hebrew Letter Dalet With Dagesh",
            "1": "One",
            "\ud83d\ude00": "Emoji: Grinning Face",
            "\u0080": "Control",
            "\u00f6": "Latin Small Letter O With Diaeresis"
        }"#;

        assert_eq!(
            canonical_json_string_from_str(json).unwrap(),
            "{\"\\r\":\"Carriage Return\",\"1\":\"One\",\"\":\"Control\",\"ö\":\"Latin Small Letter O With Diaeresis\",\"€\":\"Euro Sign\",\"😀\":\"Emoji: Grinning Face\",\"דּ\":\"Hebrew Letter Dalet With Dagesh\"}"
        );
    }

    #[test]
    fn serializes_numbers_like_ecmascript_json_stringify() {
        let value = json!({
            "numbers": [
                1.0,
                -0.0,
                0.000001,
                0.0000001,
                100000000000000000000.0,
                1000000000000000000000.0
            ]
        });

        assert_eq!(
            canonical_json_string(&value),
            r#"{"numbers":[1,0,0.000001,1e-7,100000000000000000000,1e+21]}"#
        );
    }

    #[test]
    fn rejects_duplicate_property_names_from_textual_json() {
        let error = canonical_json_string_from_str(r#"{"a":1,"a":2}"#).unwrap_err();

        assert!(matches!(error, SsiError::InvalidJson(_)));
        assert!(error.to_string().contains("duplicate JSON property name: a"));
    }
}
