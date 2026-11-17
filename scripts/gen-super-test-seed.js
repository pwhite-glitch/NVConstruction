#!/usr/bin/env node
// Prints the seed SQL for migration 077 (prompt 88) from data/super-test-questions.json.
// No dependencies. Paste the output between the markers in migrations/077_super_weekly_test.sql:
//   -- BEGIN GENERATED SEED (scripts/gen-super-test-seed.js)
//   -- END GENERATED SEED
// tests/prompt88-super-weekly-test.test.js regenerates it and checks 077 matches byte-for-byte.
//
// Usage: node scripts/gen-super-test-seed.js > /path/inside/worktree/seed.sql

const fs = require('fs')
const path = require('path')

const sqlText = v => (v === null || v === undefined ? 'NULL' : `'${String(v).replace(/'/g, "''")}'`)

function buildSeedSql(questions) {
  const qRows = questions.map(q => `  (${[
    sqlText(q.id), sqlText(q.category), sqlText(q.topic), sqlText(q.store), sqlText(q.question),
    `${sqlText(JSON.stringify(q.choices))}::jsonb`, sqlText(q.source), q.sample ? 'true' : 'false',
  ].join(', ')})`)
  const kRows = questions.map(q => `  (${[sqlText(q.id), String(Number(q.correct_index)), sqlText(q.explanation)].join(', ')})`)
  return [
    'INSERT INTO public.super_test_questions (id, category, topic, store, question, choices, source, is_sample) VALUES',
    qRows.join(',\n'),
    'ON CONFLICT (id) DO NOTHING;',
    '',
    'INSERT INTO public.super_test_answer_keys (question_id, correct_index, explanation) VALUES',
    kRows.join(',\n'),
    'ON CONFLICT (question_id) DO NOTHING;',
    '',
  ].join('\n')
}

function loadQuestions(file = path.join(__dirname, '..', 'data', 'super-test-questions.json')) {
  return JSON.parse(fs.readFileSync(file, 'utf8'))
}

module.exports = { buildSeedSql, loadQuestions }

if (require.main === module) process.stdout.write(buildSeedSql(loadQuestions()))
