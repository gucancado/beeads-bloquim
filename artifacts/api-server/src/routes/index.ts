import { Router, type IRouter } from "express";
import healthRouter from "./health";
import authRouter from "./auth";
import workspacesRouter from "./workspaces";
import mapsRouter from "./maps";
import cardsRouter from "./cards";
import myTasksRouter from "./myTasks";

const router: IRouter = Router();

router.use(healthRouter);
router.use("/auth", authRouter);
router.use("/workspaces", workspacesRouter);
router.use("/workspaces/:workspaceId/maps", mapsRouter);
router.use("/workspaces/:workspaceId/maps/:mapId/cards", cardsRouter);
router.use("/my-tasks", myTasksRouter);

export default router;
