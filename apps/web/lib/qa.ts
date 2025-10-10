import type { QaResponse, ReturnState } from '@/shared';

const filingStatusOptions = ['Single', 'Married filing jointly', 'Married filing separately', 'Head of household'] as const;
const mileageHelp = 'Enter business miles for 2024.';

export function nextQuestions(state: ReturnState): QaResponse {
  const questions: QaResponse['questions'] = [];

  if (!state.filing_status) {
    questions.push({
      id: 'filing_status',
      label: 'What is your filing status?',
      type: 'select',
      options: [...filingStatusOptions],
      help: 'Choose how you plan to file your 2024 tax return.'
    });
  }

  if (!state.zip) {
    questions.push({
      id: 'zip',
      label: 'What is your home ZIP code?',
      type: 'text',
      help: 'Use 5 digits or ZIP+4.',
      validation: { pattern: '^(\\d{5})(-\\d{4})?$' }
    });
  }

  if (typeof state.dependents_under_17 !== 'number') {
    questions.push({
      id: 'dependents_under_17',
      label: 'How many dependents under age 17 will you claim?',
      type: 'number',
      help: 'Enter 0 if none.'
    });
  }

  if (typeof state.dependents_total !== 'number') {
    questions.push({
      id: 'dependents_total',
      label: 'Total dependents?',
      type: 'number',
      help: 'Include all qualifying dependents.'
    });
  }

  if (!state.gig_method) {
    questions.push({
      id: 'gig_method',
      label: 'How do you want to track gig expenses?',
      type: 'select',
      options: ['Standard mileage', 'Actual expenses'],
      help: 'Choose mileage if you track miles, or actual expenses if you have detailed receipts.'
    });
  }

  if (state.gig_method === 'Standard mileage' && typeof state.miles !== 'number') {
    questions.push({
      id: 'miles',
      label: 'Business miles driven in 2024?',
      type: 'number',
      help: mileageHelp
    });
  }

  if (state.gig_method === 'Actual expenses') {
    const actual = state.actual ?? {};
    const actualQuestions: { id: keyof NonNullable<ReturnState['actual']>; label: string }[] = [
      { id: 'fuel', label: 'Fuel costs (USD)' },
      { id: 'insurance', label: 'Auto insurance (USD)' },
      { id: 'maintenance', label: 'Maintenance + repairs (USD)' },
      { id: 'dmv', label: 'DMV / registration fees (USD)' },
      { id: 'depreciation', label: 'Depreciation (USD)' }
    ];
    for (const item of actualQuestions) {
      if (typeof actual[item.id] !== 'number') {
        questions.push({
          id: `actual.${item.id}` as const,
          label: item.label,
          type: 'currency',
          help: 'Round to the nearest dollar.'
        });
      }
    }
  }

  if (typeof state.phone_percent !== 'number') {
    questions.push({
      id: 'phone_percent',
      label: 'What percent of your phone usage is for business?',
      type: 'number',
      help: 'Estimate business use as a whole number (0-100).',
      validation: { min: 0, max: 100 }
    });
  }

  const flags = state.validation_flags ?? [];
  if (flags.includes('ss_rate_mismatch') && state.confirm_ss_tax !== true) {
    questions.push({
      id: 'confirm_ss_tax',
      label: 'Social Security tax looks different from the expected rate. Can you confirm it matches your form?',
      type: 'select',
      options: ['Yes', 'No']
    });
  }

  if (flags.includes('medicare_rate_mismatch') && state.confirm_medicare_tax !== true) {
    questions.push({
      id: 'confirm_medicare_tax',
      label: 'Medicare tax looks different from the expected rate. Does the amount match your form?',
      type: 'select',
      options: ['Yes', 'No']
    });
  }

  if (flags.includes('ein_invalid') && state.confirm_ein !== true) {
    questions.push({
      id: 'confirm_ein',
      label: 'Can you confirm your employer EIN matches the document?',
      type: 'select',
      options: ['Yes', 'No']
    });
  }

  return {
    questions,
    completed: questions.length === 0,
    notes: questions.length === 0 ? 'All mandatory data captured.' : undefined
  };
}
