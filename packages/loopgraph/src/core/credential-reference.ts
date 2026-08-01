import { z } from "zod";

export const credentialReferenceSchema = z.string()
  .min(8)
  .max(1024)
  .regex(
    /^(?:broker|hermes|aws-sm|gcp-sm|azure-kv|vault|keychain|env-ref):\/\/[A-Za-z0-9][A-Za-z0-9._~:/+-]*$/,
    "credentialRef must be an opaque broker, vault, keychain, or development-only environment reference"
  )
  .refine((value) => !/[?#]/.test(value), "credentialRef must not contain query strings or fragments")
  .refine((value) => !hasDotSegment(value), "credentialRef must not contain relative path segments");

export type CredentialReference = z.infer<typeof credentialReferenceSchema>;

export const customerManagedKeyReferenceSchema = z.string()
  .min(8)
  .max(1024)
  .regex(/^(?:aws-kms|gcp-kms|azure-key|vault-transit):\/\/[A-Za-z0-9][A-Za-z0-9._~:/+=,-]*$/)
  .refine((value) => !/[?#]/.test(value), "customer-managed key reference must not contain query strings or fragments")
  .refine((value) => !hasDotSegment(value), "customer-managed key reference must not contain relative path segments");

export type CustomerManagedKeyReference = z.infer<typeof customerManagedKeyReferenceSchema>;

function hasDotSegment(value: string) {
  return value.slice(value.indexOf("://") + 3).split("/").some((segment) => segment === "." || segment === "..");
}
