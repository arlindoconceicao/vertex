use serde_json::Value;

use crate::errors::Result;

/// Converte uma string JSON para sua representação canônica.
///
/// A entrada é analisada como JSON e depois serializada com regras estáveis,
/// incluindo ordenação lexicográfica das chaves de objetos.
pub fn canonical_json_string_from_str(json: &str) -> Result<String> {
    let value: Value = serde_json::from_str(json)?;
    Ok(canonical_json_string(&value))
}

/// Serializa um valor JSON canônico como bytes UTF-8.
///
/// Use esta função quando a próxima etapa espera bytes, como hashing,
/// assinatura ou montagem de mensagens com separação de domínio.
pub fn canonical_json_bytes(value: &Value) -> Vec<u8> {
    canonical_json_string(value).into_bytes()
}

/// Serializa um valor JSON usando regras canônicas estáveis.
///
/// Objetos têm suas chaves ordenadas, arrays preservam sua ordem original e
/// strings são escapadas pelo serializador JSON padrão.
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
        Value::Number(value) => out.push_str(&value.to_string()),
        Value::String(value) => out.push_str(
            &serde_json::to_string(value).expect("JSON string serialization cannot fail"),
        ),
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
            entries.sort_by(|(left_key, _), (right_key, _)| left_key.cmp(right_key));

            for (index, (key, value)) in entries.into_iter().enumerate() {
                if index > 0 {
                    out.push(',');
                }
                out.push_str(
                    &serde_json::to_string(key).expect("JSON object key serialization cannot fail"),
                );
                out.push(':');
                write_canonical_json(value, out);
            }

            out.push('}');
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

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
}
