use rcgen::{BasicConstraints, Certificate, CertificateParams, IsCa, KeyPair, SerialNumber};
use std::fs;
use std::path::Path;
use time::OffsetDateTime;

use crate::runtime::private_file::{restrict_permissions, write_private_file};

pub struct CaService {
    ca_cert: Certificate,
    ca_key: KeyPair,
}

impl CaService {
    pub fn new(app_data_dir: &Path) -> Result<Self, String> {
        let ca_dir = app_data_dir.join("ca");
        if !ca_dir.exists() {
            fs::create_dir_all(&ca_dir).map_err(|e| e.to_string())?;
        }

        let key_path = ca_dir.join("root.key");
        let cert_path = ca_dir.join("root.crt");

        let key_pair = if key_path.exists() {
            // Older versions wrote the key world-readable.
            if let Err(e) = restrict_permissions(&key_path) {
                tracing::warn!("[ca] could not restrict root.key permissions: {e}");
            }
            let key_pem = fs::read_to_string(&key_path).map_err(|e| e.to_string())?;
            KeyPair::from_pem(&key_pem).map_err(|e: rcgen::Error| e.to_string())?
        } else {
            let kp = KeyPair::generate().map_err(|e: rcgen::Error| e.to_string())?;
            write_private_file(&key_path, kp.serialize_pem().as_bytes())?;
            kp
        };

        let mut params = CertificateParams::default();
        params
            .distinguished_name
            .push(rcgen::DnType::CommonName, "Horizon Gateway Root CA");
        params
            .distinguished_name
            .push(rcgen::DnType::OrganizationName, "Horizon Gateway");
        params.is_ca = IsCa::Ca(BasicConstraints::Unconstrained);
        params.key_usages = vec![
            rcgen::KeyUsagePurpose::KeyCertSign,
            rcgen::KeyUsagePurpose::DigitalSignature,
            rcgen::KeyUsagePurpose::CrlSign,
        ];

        // Use a fixed start date and serial number for determinism.
        // This ensures the same root.crt is generated from the same root.key.
        params.not_before =
            OffsetDateTime::from_unix_timestamp(1_704_067_200).map_err(|e| e.to_string())?; // 2024-01-01
        params.not_after = params.not_before + time::Duration::days(365 * 10); // 10 years
        params.serial_number = Some(SerialNumber::from(1u64));

        let ca_cert = params
            .self_signed(&key_pair)
            .map_err(|e: rcgen::Error| e.to_string())?;

        // Always write the certificate to ensure it exists and matches the key.
        fs::write(&cert_path, ca_cert.pem()).map_err(|e| e.to_string())?;

        Ok(Self {
            ca_cert,
            ca_key: key_pair,
        })
    }

    pub fn ca_cert_pem(&self) -> String {
        self.ca_cert.pem()
    }

    pub fn sign_host_certificate(
        &self,
        host: &str,
    ) -> Result<(rcgen::Certificate, KeyPair), String> {
        let key_pair = KeyPair::generate().map_err(|e: rcgen::Error| e.to_string())?;
        let mut params = CertificateParams::new(vec![host.to_string()])
            .map_err(|e: rcgen::Error| e.to_string())?;
        params
            .distinguished_name
            .push(rcgen::DnType::CommonName, host);

        let now = OffsetDateTime::now_utc();
        params.not_before = now - time::Duration::days(1);
        params.not_after = now + time::Duration::days(365 * 2);

        let cert = params
            .signed_by(&key_pair, &self.ca_cert, &self.ca_key)
            .map_err(|e: rcgen::Error| e.to_string())?;
        Ok((cert, key_pair))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[test]
    fn test_ca_service_creation_and_signing() {
        let dir = tempdir().unwrap();
        let ca_service = CaService::new(dir.path()).unwrap();

        // 1. Verify Root CA PEM
        let ca_pem = ca_service.ca_cert_pem();
        assert!(ca_pem.contains("BEGIN CERTIFICATE"));
        assert!(ca_pem.contains("END CERTIFICATE"));

        // 2. Sign host certificate
        let host = "example.com";
        let (cert, _key) = ca_service.sign_host_certificate(host).unwrap();
        let cert_pem = cert.pem();
        assert!(cert_pem.contains("BEGIN CERTIFICATE"));
    }

    #[cfg(unix)]
    #[test]
    fn root_key_is_owner_only_including_existing_installs() {
        use std::os::unix::fs::PermissionsExt;
        let dir = tempdir().unwrap();
        let key_path = dir.path().join("ca").join("root.key");
        let mode = |p: &Path| fs::metadata(p).unwrap().permissions().mode() & 0o777;

        CaService::new(dir.path()).unwrap();
        assert_eq!(mode(&key_path), 0o600);
        let key_pem = fs::read_to_string(&key_path).unwrap();

        fs::set_permissions(&key_path, fs::Permissions::from_mode(0o644)).unwrap();
        CaService::new(dir.path()).unwrap();
        assert_eq!(mode(&key_path), 0o600);
        assert_eq!(
            fs::read_to_string(&key_path).unwrap(),
            key_pem,
            "same key reused"
        );
    }
}
