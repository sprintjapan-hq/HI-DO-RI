import { Router, type IRouter } from "express";
import healthRouter from "./health";
import pollsRouter from "./polls";
import featureRequestsRouter from "./feature-requests";
import calendarPreviewRouter from "./calendar-preview";

const router: IRouter = Router();

router.use(healthRouter);
router.use(pollsRouter);
router.use(featureRequestsRouter);
router.use(calendarPreviewRouter);

export default router;
