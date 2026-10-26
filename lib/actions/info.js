/**
 * Full metadata of one asset (Admin API `resource`), resolved by name, path, public ID or asset_id.
 */
export async function actionInfo(backend, { cwd = '', target, resourceType, deliveryType } = {}) {
  const ref = await backend.resolveAsset(cwd, target, { resourceType, deliveryType });
  return backend.call(() => backend.sdk.api.resource(ref.public_id, { resource_type: ref.resource_type, type: ref.type }))
    .then(({ rate_limit_allowed, rate_limit_remaining, rate_limit_reset_at, ...details }) => details);
}
