import { describe, it, expect, afterAll, beforeEach, vi } from "vitest";

/**
 * Regression lock for the production 500 on
 * `PATCH /api/workspaces/:workspaceId/tasks/:taskId` with a schedule body
 * (bug task 7903bc06-…).
 *
 * Root cause (confirmed via prod logs + controlled repro): the handler runs
 * its audit side-effects (`recordTaskActivity`) AFTER the core task update has
 * already committed and OUTSIDE any transaction. When the
 * `due_date_changed` insert fails — e.g. the task row was deleted concurrently,
 * producing an FK violation on `task_activities.task_id` — the exception
 * propagates and the user gets a 500 even though the schedule update itself
 * succeeded. Activity logging is a best-effort audit concern and must never
 * fail the user-facing mutation.
 *
 * We simulate the failing audit insert by making `recordTaskActivity` throw
 * only for the `due_date_changed` type (the exact insert seen failing in
 * prod), leaving every other activity insert real so the test fixtures
 * (card creation records `task_created`, etc.) are unaffected.
 */
vi.mock("../services/taskActivitiesService", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../services/taskActivitiesService")>();
  return {
    ...actual,
    recordTaskActivity: vi.fn((args: Parameters<typeof actual.recordTaskActivity>[0]) =>
      actual.recordTaskActivity(args),
    ),
  };
});

import { recordTaskActivity } from "../services/taskActivitiesService";
import { registerAndLogin, deleteUser, deleteWorkspaces } from "./helpers";

const mockedRecord = vi.mocked(recordTaskActivity);

async function realRecordImpl() {
  const actual = await vi.importActual<
    typeof import("../services/taskActivitiesService")
  >("../services/taskActivitiesService");
  return actual.recordTaskActivity;
}

describe("schedule activity resilience smoke", () => {
  const createdUserIds: string[] = [];
  const createdWorkspaceIds: string[] = [];

  beforeEach(async () => {
    // Default: every activity insert behaves for real.
    const real = await realRecordImpl();
    mockedRecord.mockImplementation((args) => real(args));
  });

  afterAll(async () => {
    await deleteWorkspaces(createdWorkspaceIds);
    for (const id of createdUserIds) await deleteUser(id);
  });

  /** Builds a workspace + map + card-backed task, returns ids. */
  async function makePlanCardTask() {
    const { agent, user } = await registerAndLogin();
    createdUserIds.push(user.id);

    const wsRes = await agent
      .post("/api/workspaces")
      .send({ name: "Schedule Resilience WS", colorIndex: 0 });
    expect(wsRes.status).toBe(201);
    const workspaceId = wsRes.body.id as string;
    createdWorkspaceIds.push(workspaceId);

    const mapRes = await agent
      .post(`/api/workspaces/${workspaceId}/maps`)
      .send({ name: "Plan" });
    expect(mapRes.status).toBe(201);
    const mapId = mapRes.body.id as string;

    const cardRes = await agent
      .post(`/api/workspaces/${workspaceId}/maps/${mapId}/cards`)
      .send({ title: "Card task", positionX: 0, positionY: 0 });
    expect(cardRes.status).toBe(201);
    const taskId = cardRes.body.taskId as string;

    return { agent, workspaceId, taskId };
  }

  it("persists schedule on a plan card and returns 200 (happy path)", async () => {
    const { agent, workspaceId, taskId } = await makePlanCardTask();

    const res = await agent
      .patch(`/api/workspaces/${workspaceId}/tasks/${taskId}`)
      .send({ scheduleMode: "ate", dueDate: "2026-12-20", startAt: null });

    expect(res.status).toBe(200);
    expect(res.body.scheduleMode).toBe("ate");
    expect(res.body.dueDate).toBeTruthy();
    expect(new Date(res.body.dueDate).toISOString().slice(0, 10)).toBe(
      "2026-12-20",
    );
  });

  it("does not 500 when the due_date_changed audit insert fails", async () => {
    const { agent, workspaceId, taskId } = await makePlanCardTask();

    // Simulate the prod failure: the audit insert for the schedule change
    // blows up (FK violation: task deleted concurrently). Every other
    // activity type stays real.
    const real = await realRecordImpl();
    mockedRecord.mockImplementation((args) => {
      if (args.type === "due_date_changed") {
        throw new Error(
          "simulated task_activities insert failure (FK violation: task deleted concurrently)",
        );
      }
      return real(args);
    });

    const res = await agent
      .patch(`/api/workspaces/${workspaceId}/tasks/${taskId}`)
      .send({ scheduleMode: "ate", dueDate: "2026-12-20", startAt: null });

    // The audit log is non-critical; the schedule mutation must still succeed.
    expect(res.status).toBe(200);
    expect(res.body.scheduleMode).toBe("ate");
    expect(new Date(res.body.dueDate).toISOString().slice(0, 10)).toBe(
      "2026-12-20",
    );

    // And the change is durably persisted (read it back).
    const readBack = await agent.get(
      `/api/workspaces/${workspaceId}/tasks/${taskId}`,
    );
    expect(readBack.status).toBe(200);
    expect(readBack.body.scheduleMode).toBe("ate");
    expect(new Date(readBack.body.dueDate).toISOString().slice(0, 10)).toBe(
      "2026-12-20",
    );
  });
});
