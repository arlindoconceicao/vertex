use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::collections::BTreeSet;

use crate::{
    Result, SsiError, canonical_json,
    encoding::{base64_encode, multibase_base58btc_encode},
    hash::sha3_256,
};

const SCHEMA_HASH_DOMAIN: &[u8] = b"SSI_PQ_SCHEMA_HASH_SHA3_256_V1";

/// Opções usadas para criar um Schema SSI-PQ.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SchemaCreateOptions {
    /// Versão textual do Schema.
    pub version: String,
    /// Timestamp de criação gravado no documento.
    pub created_at: String,
}

/// Documento de Schema SSI-PQ.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct SchemaDocument {
    /// Tipo/versionamento lógico do documento.
    #[serde(rename = "type")]
    pub document_type: String,
    /// Identificador estável derivado do conteúdo canônico do Schema.
    pub schema_id: String,
    /// Versão textual do Schema.
    pub version: String,
    /// Timestamp de criação em formato textual RFC 3339.
    pub created_at: String,
    /// Atributos previstos pelo Schema.
    pub attributes: Vec<SchemaAttribute>,
}

/// Atributo declarado em um Schema SSI-PQ.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct SchemaAttribute {
    /// Caminho canônico do atributo dentro do assunto da credencial.
    pub path: String,
    /// Tipo primitivo inferido para o atributo.
    #[serde(rename = "type")]
    pub attr_type: String,
    /// Indica se o atributo é obrigatório na emissão da credencial.
    pub required: bool,
}

/// Cria um Schema padronizado a partir de um JSON de atributos.
///
/// A entrada deve ser um objeto JSON. Chaves planas viram caminhos
/// `subject.<chave>` e objetos aninhados são achatados em caminhos pontuados,
/// como `subject.endereco.rua`.
pub fn create_schema_from_attributes(
    attributes: &Value,
    options: SchemaCreateOptions,
) -> Result<SchemaDocument> {
    crate::time::validate_rfc3339_timestamp("created_at", &options.created_at)
        .map_err(SsiError::InvalidSchema)?;

    let mut schema_attributes = flatten_attribute_values(attributes)?
        .into_iter()
        .map(|(path, value)| {
            Ok(SchemaAttribute {
                path,
                attr_type: infer_attribute_type(value).to_string(),
                required: true,
            })
        })
        .collect::<Result<Vec<_>>>()?;

    schema_attributes.sort_by(|left, right| left.path.cmp(&right.path));

    let schema_id = schema_id_from_parts(&options.version, &schema_attributes)?;

    Ok(SchemaDocument {
        document_type: "ssi_schema_v1".to_string(),
        schema_id,
        version: options.version,
        created_at: options.created_at,
        attributes: schema_attributes,
    })
}

/// Verifica se o `schema_id` corresponde ao conteúdo canônico do Schema.
///
/// O timestamp `created_at` não participa do identificador, permitindo que a
/// plataforma registre metadados temporais sem alterar a identidade do Schema.
pub fn schema_id_matches_definition(schema: &SchemaDocument) -> Result<bool> {
    Ok(schema.schema_id == schema_id_from_parts(&schema.version, &schema.attributes)?)
}

/// Calcula o hash SHA3-256/Base64 da definição lógica do Schema.
///
/// Assim como `schema_id`, este hash ignora `created_at` e considera a versão
/// e os atributos canônicos do Schema. O formato Base64 facilita exibição no
/// PDF e comparação com identificadores de credencial.
pub fn schema_hash_base64(schema: &SchemaDocument) -> Result<String> {
    schema_hash_base64_from_parts(&schema.version, &schema.attributes)
}

/// Infere o tipo primitivo usado no Schema para um valor JSON.
pub fn infer_attribute_type(value: &Value) -> &'static str {
    match value {
        Value::Null => "null",
        Value::Bool(_) => "boolean",
        Value::Number(number) if number.is_i64() || number.is_u64() => "integer",
        Value::Number(_) => "number",
        Value::String(_) => "string",
        Value::Array(_) => "array",
        Value::Object(_) => "object",
    }
}

/// Lê do JSON de atributos o valor correspondente ao caminho achatado do Schema.
pub fn value_for_schema_path<'a>(attributes: &'a Value, path: &str) -> Result<&'a Value> {
    flatten_attribute_values(attributes)?
        .into_iter()
        .find(|(candidate_path, _)| candidate_path == path)
        .map(|(_, value)| value)
        .ok_or_else(|| SsiError::MissingAttribute(path.to_string()))
}

/// Valida se os atributos informados satisfazem o Schema.
///
/// Esta validação cobre presença de atributos obrigatórios, compatibilidade de
/// tipos primitivos e rejeição de atributos não declarados.
pub fn validate_attributes_against_schema(
    schema: &SchemaDocument,
    attributes: &Value,
) -> Result<()> {
    if !schema_id_matches_definition(schema)? {
        return Err(SsiError::InvalidSchema(
            "schema_id does not match schema definition".to_string(),
        ));
    }

    let attribute_values = flatten_attribute_values(attributes)
        .map_err(|error| SsiError::InvalidCredential(error.to_string()))?;
    let declared_paths = schema
        .attributes
        .iter()
        .map(|attribute| attribute.path.as_str())
        .collect::<BTreeSet<_>>();

    for attribute in &schema.attributes {
        if attribute.required {
            let value = attribute_values
                .iter()
                .find(|(path, _)| path == &attribute.path)
                .map(|(_, value)| *value)
                .ok_or_else(|| SsiError::MissingAttribute(attribute.path.clone()))?;

            let actual = infer_attribute_type(value);
            if actual != attribute.attr_type {
                return Err(SsiError::AttributeTypeMismatch {
                    path: attribute.path.clone(),
                    expected: attribute.attr_type.clone(),
                    actual: actual.to_string(),
                });
            }
        }
    }

    for (path, _) in &attribute_values {
        if !declared_paths.contains(path.as_str()) {
            return Err(SsiError::InvalidCredential(format!(
                "attribute '{path}' is not declared in schema"
            )));
        }
    }

    Ok(())
}

/// Converte um Schema tipado para `serde_json::Value`.
pub fn schema_to_json(schema: &SchemaDocument) -> Result<Value> {
    Ok(serde_json::to_value(schema)?)
}

/// Converte um `serde_json::Value` para Schema tipado.
pub fn schema_from_json(value: Value) -> Result<SchemaDocument> {
    Ok(serde_json::from_value(value)?)
}

fn schema_id_from_parts(version: &str, attributes: &[SchemaAttribute]) -> Result<String> {
    let value = json!({
        "type": "ssi_schema_v1",
        "version": version,
        "attributes": attributes,
    });
    let canonical = canonical_json::canonical_json_bytes(&value);
    Ok(format!(
        "schema_{}",
        multibase_base58btc_encode(&sha3_256(&canonical))
    ))
}

fn schema_hash_base64_from_parts(version: &str, attributes: &[SchemaAttribute]) -> Result<String> {
    let attributes_value = serde_json::to_value(attributes)?;
    let attributes_canonical = canonical_json::canonical_json_bytes(&attributes_value);
    let mut input = Vec::new();

    input.extend_from_slice(SCHEMA_HASH_DOMAIN);
    push_schema_hash_component(&mut input, b"version", version.as_bytes());
    push_schema_hash_component(&mut input, b"attributes", &attributes_canonical);

    Ok(base64_encode(&sha3_256(&input)))
}

fn push_schema_hash_component(input: &mut Vec<u8>, label: &[u8], value: &[u8]) {
    input.extend_from_slice(b"\x1eSSI_PQ_SCHEMA_HASH_FIELD\x1f");
    input.extend_from_slice(&(label.len() as u64).to_be_bytes());
    input.extend_from_slice(label);
    input.extend_from_slice(&(value.len() as u64).to_be_bytes());
    input.extend_from_slice(value);
}

fn flatten_attribute_values(attributes: &Value) -> Result<Vec<(String, &Value)>> {
    let object = attributes.as_object().ok_or_else(|| {
        SsiError::InvalidSchema("schema source must be a plain JSON object".to_string())
    })?;
    let mut output = Vec::new();
    let mut seen = BTreeSet::new();

    for (name, value) in object {
        flatten_attribute_value(format!("subject.{name}"), value, &mut seen, &mut output)?;
    }

    output.sort_by(|(left, _), (right, _)| left.cmp(right));
    Ok(output)
}

fn flatten_attribute_value<'a>(
    path: String,
    value: &'a Value,
    seen: &mut BTreeSet<String>,
    output: &mut Vec<(String, &'a Value)>,
) -> Result<()> {
    if let Value::Object(object) = value
        && !object.is_empty()
    {
        for (name, child) in object {
            flatten_attribute_value(format!("{path}.{name}"), child, seen, output)?;
        }
        return Ok(());
    }

    if !seen.insert(path.clone()) {
        return Err(SsiError::InvalidSchema(format!(
            "attribute path collision after flattening: {path}"
        )));
    }
    output.push((path, value));
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn schema_id_ignores_input_key_order() {
        let options = SchemaCreateOptions {
            version: "1".to_string(),
            created_at: "2026-05-27T00:00:00Z".to_string(),
        };
        let left =
            create_schema_from_attributes(&json!({"nome": "Ana", "idade": 30}), options.clone())
                .unwrap();
        let right =
            create_schema_from_attributes(&json!({"idade": 30, "nome": "Ana"}), options).unwrap();

        assert_eq!(left.schema_id, right.schema_id);
        assert_eq!(left.attributes[0].path, "subject.idade");
        assert_eq!(left.attributes[1].path, "subject.nome");
    }

    #[test]
    fn schema_flattens_nested_values() {
        let schema = create_schema_from_attributes(
            &json!({"nome": {"primeiro": "Ana", "ultimo": "Silva"}, "idade": 30}),
            SchemaCreateOptions {
                version: "1".to_string(),
                created_at: "2026-05-27T00:00:00Z".to_string(),
            },
        )
        .unwrap();

        assert_eq!(
            schema
                .attributes
                .iter()
                .map(|attribute| attribute.path.as_str())
                .collect::<Vec<_>>(),
            vec![
                "subject.idade",
                "subject.nome.primeiro",
                "subject.nome.ultimo"
            ]
        );
    }

    #[test]
    fn schema_rejects_flattened_path_collisions() {
        let result = create_schema_from_attributes(
            &json!({"nome.primeiro": "Ana", "nome": {"primeiro": "Maria"}}),
            SchemaCreateOptions {
                version: "1".to_string(),
                created_at: "2026-05-27T00:00:00Z".to_string(),
            },
        );

        assert!(result.is_err());
    }
}
