import { Router, type IRouter } from "express";
import healthRouter from "./health";
import authRouter from "./auth";
import workspacesRouter from "./workspaces";
import mapsRouter from "./maps";
import cardsRouter from "./cards";
import connectionsRouter from "./connections";
import myTasksRouter from "./myTasks";
import commentsRouter from "./comments";
import workspaceTasksRouter from "./workspaceTasks";
import recentMapsRouter from "./recentMaps";

const router: IRouter = Router();

router.use(healthRouter);
router.use("/auth", authRouter);
router.use("/workspaces", workspacesRouter);
router.use("/workspaces/:workspaceId/maps", mapsRouter);
router.use("/workspaces/:workspaceId/maps/:mapId/cards", cardsRouter);
router.use("/workspaces/:workspaceId/maps/:mapId/cards", commentsRouter);
router.use("/workspaces/:workspaceId/maps/:mapId/connections", connectionsRouter);
router.use("/workspaces/:workspaceId/tasks", workspaceTasksRouter);
router.use("/my-tasks", myTasksRouter);
router.use("/maps/recent", recentMapsRouter);

export default router;
