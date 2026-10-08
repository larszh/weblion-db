import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { OrgDto } from '@weblion/shared';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { useOrg } from '@/lib/org-context';
import { formatDate } from '@/lib/format';
import { qk, useApiMutation } from '@/lib/queries';
import type { TranslationKey } from '@/i18n/de';
import { Button } from '@/components/ui/button';
import {
  Badge,
  Card,
  CardBody,
  CardHeader,
  Field,
  Input,
  KeyValue,
  Mono,
  PageHeader,
} from '@/components/ui/primitives';

export function OrgSettingsPage() {
  const { t, locale } = useI18n();
  const { org, can } = useOrg();
  const qc = useQueryClient();
  const [name, setName] = useState(org.name);
  const save = useApiMutation(() => api.patch<OrgDto>(`/orgs/${org.id}`, { name }), {
    success: t('common.saved'),
    invalidate: [qk.orgs, qk.me],
    onSuccess: (updated) => qc.setQueryData(qk.orgBySlug(org.slug), updated),
  });

  return (
    <>
      <PageHeader title={t('nav.settings')} description={t('orgSettings.subtitle')} />
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader title={t('orgSettings.general')} />
          <CardBody className="space-y-4">
            <Field label={t('orgSettings.name')} htmlFor="org-name">
              <Input
                id="org-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                disabled={!can('org:update')}
              />
            </Field>
            {can('org:update') && (
              <Button
                variant="primary"
                disabled={!name.trim() || name === org.name}
                loading={save.isPending}
                onClick={() => save.mutate(undefined)}
              >
                {t('common.save')}
              </Button>
            )}
          </CardBody>
        </Card>
        <Card>
          <CardHeader title={t('orgSettings.info')} />
          <CardBody className="py-1">
            <KeyValue
              items={[
                { label: 'ID', value: <Mono>{org.id}</Mono> },
                { label: 'Slug', value: <Mono>{org.slug}</Mono> },
                {
                  label: t('orgSettings.kind'),
                  value: <Badge>{t(`orgKind.${org.kind}`)}</Badge>,
                },
                {
                  label: t('orgSettings.status'),
                  value: (
                    <Badge tone={org.status === 'active' ? 'success' : 'danger'}>
                      {t(`orgStatus.${org.status}`)}
                    </Badge>
                  ),
                },
                {
                  label: t('orgSettings.yourRole'),
                  value: org.role ? t(`role.${org.role}` as TranslationKey) : t('nav.staffAccess'),
                },
                { label: t('orgSettings.created'), value: formatDate(org.createdAt, locale, false) },
              ]}
            />
          </CardBody>
        </Card>
      </div>
    </>
  );
}
