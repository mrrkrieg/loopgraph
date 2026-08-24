export const HOSTED_APP_SNAPSHOT_INVENTORY_FENCE_FUNCTION_DIGESTS = {
  generationAdvance: "sha256:3861821582a1881e8741b10c676bfb9952259c3638278b1ab84d161f81a2f693",
  scopeBump: "sha256:9b61fbfb993aafd7c92cd6793e63173ed2c3557af29f3aea11edb52054eb8c18",
  storageTrigger: "sha256:2076106e25557bcf474066ebb977c8aeec3b4c4edad4f7560e96bb85217af7f2",
  registryTrigger: "sha256:c1229bddf6e58df5a9bfb6b7c5d233fc0e3dfb1a7dffbe8ec04750d43c01fb5c",
  generationReader: "sha256:4839d46f4659cbdc05aed473e737ca7b8a4ea1410eeb082c0fe9252f28cf1048",
  fenceAttestation: "sha256:d88fe8d85cc425470028fe2193001aa75f6aed03e46e94f9802a08dc8c50de08"
} as const;

export const HOSTED_APP_SNAPSHOT_INVENTORY_FENCE_EXPECTED_STATUS = {
  schemaVersion: "hosted-app-snapshot-inventory-fence/v1",
  storageTriggerEnabled: true,
  registryTriggerEnabled: true,
  generationReaderServiceOnly: true,
  mutationFunctionsTriggerOnly: true,
  mutationFunctionsHardened: true,
  functionDefinitionDigests: HOSTED_APP_SNAPSHOT_INVENTORY_FENCE_FUNCTION_DIGESTS,
  functionOwnersPinned: true,
  functionAclsPinned: true
} as const;
