import { mergeTests } from "@playwright/test";
import { test as intentTest } from "playwright-intent";
import { testWithNewUser } from "../tests/test-with-new-user";

export const test = mergeTests(testWithNewUser, intentTest);
export { expect } from "playwright-intent";
