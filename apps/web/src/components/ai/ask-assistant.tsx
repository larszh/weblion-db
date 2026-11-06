import { MessageSquare, Sparkles } from 'lucide-react';
import { useI18n } from '@/lib/i18n';
import { Button } from '@/components/ui/button';
import { Menu, MenuItem, MenuSeparator } from '@/components/ui/menu';
import { useAiLauncherVisible } from './assistant';
import { openAssistant } from './assistant-bus';

/**
 * "KI-Assistent fragen" in the organization dashboard's header (ai 12.5): opens the panel, or asks one of
 * the three suggestions right away. Shown exactly when the launcher is (useAiLauncherVisible).
 */
export function AskAssistantMenu() {
  const { t } = useI18n();
  const visible = useAiLauncherVisible();
  if (!visible) return null;
  const suggestions = [
    t('ai.assistant.suggestion.servers'),
    t('ai.assistant.suggestion.mail'),
    t('ai.assistant.suggestion.audit'),
  ];
  return (
    <Menu
      trigger={<Button icon={<Sparkles className="size-4" aria-hidden />}>{t('ai.assistant.ask')}</Button>}
    >
      <MenuItem icon={<Sparkles />} onSelect={() => openAssistant()}>
        {t('ai.assistant.open')}
      </MenuItem>
      <MenuSeparator />
      {suggestions.map((question) => (
        <MenuItem key={question} icon={<MessageSquare />} onSelect={() => openAssistant({ question })}>
          {question}
        </MenuItem>
      ))}
    </Menu>
  );
}
