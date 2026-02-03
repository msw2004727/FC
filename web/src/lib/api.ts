import { httpsCallable } from "firebase/functions";
import { functions } from "./firebase";

export const fnCreateCustomToken = httpsCallable(functions, "createCustomToken");
export const fnRegisterActivity = httpsCallable(functions, "registerActivity");
export const fnGetCheckinQrToken = httpsCallable(functions, "getCheckinQrToken");
export const fnCheckinByToken = httpsCallable(functions, "checkinByToken");
