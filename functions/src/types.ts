export type Role = "beginner" | "veteran" | "coach" | "admin";

export type UserDoc = {
  uid: string;
  lineNickname: string;
  lineAvatarUrl: string;
  displayName?: string;
  role: Role;
  permissions: string[];
  gender?: "male" | "female" | "other" | "unknown";
  age?: number;
  contact?: { phone?: string; email?: string; lineId?: string };
  dominantFoot?: "right" | "left" | "both";
  positions?: string[];
  honorTags?: string[];
  points: number;
  coins: number;
  stats: {
    signupCount: number;
    completeCount: number;
    cancelCount: number;
    lateCancelCount: number;
  };
  createdAt: any;
  updatedAt: any;
};

export type ActivityStatus = "draft" | "scheduled" | "open" | "closed" | "canceled" | "finished";

export type ActivityDoc = {
  name: string;
  bannerUrl?: string;
  locationName: string;
  startAt: any;
  endAt: any;
  fee: number;
  capacity: number;
  waitlistCapacity?: number;
  status: ActivityStatus;
  publishAt?: any;
  closeAt?: any;
  checkinEnabled: boolean;
  checkinMethod: "qr" | "manual" | "both";
  checkinSecretVersion: number;
  createdBy: string;
  createdAt: any;
  updatedAt: any;
};
