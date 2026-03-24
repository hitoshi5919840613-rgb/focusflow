"use client";

import { db, type DecomposeTemplate } from "@/lib/client/db";
import { ensureSeedData } from "@/lib/client/seed";
import { createSubtask } from "@/lib/services/task-service";

export type TemplateInput = {
  keyword: string;
  steps: string[];
};

export async function getTemplates() {
  await db.open();
  await ensureSeedData();

  const templates = await db.decomposeTemplates.orderBy("keyword").toArray();
  return templates.sort((a, b) => a.keyword.localeCompare(b.keyword, "ja"));
}

export async function createTemplate(input: TemplateInput) {
  await db.open();
  await ensureSeedData();

  return db.decomposeTemplates.add({
    keyword: sanitizeKeyword(input.keyword),
    steps: sanitizeSteps(input.steps)
  });
}

export async function updateTemplate(templateId: number, input: TemplateInput) {
  await db.open();
  await ensureSeedData();

  await db.decomposeTemplates.update(templateId, {
    keyword: sanitizeKeyword(input.keyword),
    steps: sanitizeSteps(input.steps)
  });
}

export async function deleteTemplate(templateId: number) {
  await db.open();
  await ensureSeedData();
  await db.decomposeTemplates.delete(templateId);
}

export async function decomposeTaskFromTemplates(taskId: number, taskTitle: string) {
  await db.open();
  await ensureSeedData();

  const [templates, task, existingSubtasks] = await Promise.all([
    getTemplates(),
    db.tasks.get(taskId),
    db.tasks.where("parentTaskId").equals(taskId).toArray()
  ]);

  if (!task) {
    throw new Error("分解対象のタスクが見つかりません。");
  }

  const matchedTemplate = findBestTemplate(taskTitle, templates);
  if (!matchedTemplate) {
    return {
      template: null,
      createdSubtasks: []
    };
  }

  const existingTitles = new Set(existingSubtasks.map((subtask) => normalize(subtask.title)));
  const createdSubtasks = [];

  for (const step of matchedTemplate.steps) {
    if (existingTitles.has(normalize(step))) {
      continue;
    }

    const subtaskId = await createSubtask(taskId, step);
    createdSubtasks.push({
      id: subtaskId,
      title: step
    });
  }

  return {
    template: matchedTemplate,
    createdSubtasks
  };
}

export function suggestTemplate(taskTitle: string, templates: DecomposeTemplate[]) {
  return findBestTemplate(taskTitle, templates);
}

function findBestTemplate(taskTitle: string, templates: DecomposeTemplate[]) {
  const normalizedTitle = normalize(taskTitle);
  const scoredTemplates = templates
    .map((template) => {
      const keywords = parseKeywords(template.keyword);
      const score = keywords.reduce((sum, keyword) => (normalizedTitle.includes(normalize(keyword)) ? sum + 1 : sum), 0);

      return {
        template,
        score
      };
    })
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score);

  return scoredTemplates[0]?.template ?? null;
}

function parseKeywords(keyword: string) {
  return keyword
    .split(/[、,\s]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function sanitizeKeyword(keyword: string) {
  return keyword
    .split(/[、,\n]+/)
    .map((item) => item.trim())
    .filter(Boolean)
    .join(", ");
}

function sanitizeSteps(steps: string[]) {
  return steps.map((step) => step.trim()).filter(Boolean);
}

function normalize(text: string) {
  return text.replace(/[、。,.!！?？\s]/g, "").toLowerCase();
}
