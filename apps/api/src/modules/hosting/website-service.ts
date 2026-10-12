import type { FastifyRequest } from 'fastify';
import type { WebspaceDetailDto } from '@weblion/shared';
import type { AppContext } from '../../context';
import type { Tx } from '../../db/client';
import type { Organization } from '../../db/schema';
import { toWebspaceDto, type LoadedWebspace } from './service';

/**
 * Websites (CloudPanel): loading, live details, allowance checks of moves. Placeholder until
 * the service is implemented: the detail shows the stored facts only.
 */

/** GET /webspaces/:id for a row of kind "website". */
export async function websiteDetail(
  ctx: AppContext,
  req: FastifyRequest,
  loaded: LoadedWebspace,
): Promise<WebspaceDetailDto> {
  return {
    ...(await toWebspaceDto(ctx, req, loaded)),
    info: loaded.webspace.info,
    liveError: null,
    access: null,
    databases: [],
  };
}

/**
 * Called by the reseller move inside its transaction before a web space changes hands. Web
 * spaces (kind "webspace") always pass; a website must fit the target's website allowance.
 */
export async function assertWebsiteMoveAllowed(
  _tx: Tx,
  _webspaceId: string,
  _to: Pick<Organization, 'id' | 'parentOrgId' | 'kind'>,
): Promise<void> {}
