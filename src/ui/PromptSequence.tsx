import type React from 'react';
// A small sequential form: renders one field at a time, remembers answered
// fields above the cursor, and calls onDone with all values keyed by field.
// Secrets are collected with a masked input and never echoed back.
import { PasswordInput, TextInput } from '@inkjs/ui';
import { Box, Text, useInput } from 'ink';
import { useState } from 'react';
import { color, glyph } from './theme.ts';

export interface Prompt {
  key: string;
  label: string;
  secret?: boolean;
  initial?: string;
  placeholder?: string;
  optional?: boolean;
}

export function PromptSequence({
  prompts,
  onDone,
  onCancel,
}: {
  prompts: Prompt[];
  onDone: (values: Record<string, string>) => void;
  onCancel: () => void;
}): React.ReactNode {
  const [step, setStep] = useState(0);
  const [values, setValues] = useState<Record<string, string>>({});

  useInput((_input, key) => {
    if (key.escape) onCancel();
  });

  const submit = (raw: string) => {
    const current = prompts[step];
    const value = raw ?? '';
    if (!value && !current.optional) return; // required field: ignore empty submit
    const next = { ...values, [current.key]: value };
    setValues(next);
    if (step + 1 >= prompts.length) {
      onDone(next);
    } else {
      setStep(step + 1);
    }
  };

  return (
    <Box flexDirection="column">
      {prompts.slice(0, step).map((p) => (
        <Box key={p.key}>
          <Text color={color.accent}>{glyph.check} </Text>
          <Text color={color.muted}>{p.label}: </Text>
          <Text color={color.dim}>
            {p.secret ? '••••••••' : values[p.key] || '(empty)'}
          </Text>
        </Box>
      ))}
      <Box>
        <Text color={color.accent}>{glyph.arrow} </Text>
        <Text>{prompts[step].label}</Text>
        <Text color={color.muted}>
          {prompts[step].optional ? ' (optional)' : ''}:{' '}
        </Text>
      </Box>
      <Box marginLeft={2}>
        {prompts[step].secret ? (
          <PasswordInput
            key={prompts[step].key}
            placeholder={prompts[step].placeholder ?? '••••••••'}
            onSubmit={submit}
          />
        ) : (
          <TextInput
            key={prompts[step].key}
            defaultValue={prompts[step].initial}
            placeholder={prompts[step].placeholder}
            onSubmit={submit}
          />
        )}
      </Box>
      <Box marginTop={1}>
        <Text color={color.muted}>
          step {step + 1}/{prompts.length} {glyph.dot} ⏎ next {glyph.dot} esc cancel
        </Text>
      </Box>
    </Box>
  );
}
