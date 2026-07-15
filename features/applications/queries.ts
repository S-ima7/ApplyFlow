import {
  ApplicationStatus,
  DeadlineStatus,
  InterviewStatus,
  ProposedSlotStatus
} from "@prisma/client";
import { prisma } from "@/lib/prisma";

export async function getApplications(userId: string) {
  return prisma.application.findMany({
    where: {
      userId,
      deletedAt: null
    },
    include: {
      company: true,
      deadlines: {
        where: {
          deletedAt: null,
          status: DeadlineStatus.OPEN
        },
        orderBy: {
          dueAt: "asc"
        },
        take: 1
      },
      stages: {
        where: {
          deletedAt: null
        },
        include: {
          interviews: {
            where: {
              deletedAt: null
            },
            include: {
              proposedSlots: {
                where: {
                  deletedAt: null
                },
                orderBy: {
                  startAt: "asc"
                }
              }
            }
          }
        },
        orderBy: {
          order: "asc"
        }
      }
    },
    orderBy: {
      updatedAt: "desc"
    }
  });
}

export async function getApplicationDetail(userId: string, applicationId: string) {
  return prisma.application.findFirst({
    where: {
      id: applicationId,
      userId,
      deletedAt: null
    },
    include: {
      company: true,
      stages: {
        where: {
          deletedAt: null
        },
        include: {
          interviews: {
            where: {
              deletedAt: null
            },
            include: {
              proposedSlots: {
                where: {
                  deletedAt: null
                },
                orderBy: {
                  startAt: "asc"
                }
              }
            },
            orderBy: {
              createdAt: "asc"
            }
          }
        },
        orderBy: {
          order: "asc"
        }
      },
      deadlines: {
        where: {
          deletedAt: null
        },
        orderBy: {
          dueAt: "asc"
        }
      },
      activityLogs: {
        orderBy: {
          createdAt: "desc"
        },
        take: 30
      }
    }
  });
}

export async function getDashboardData(userId: string) {
  const now = new Date();
  const weekEnd = new Date(now);
  weekEnd.setDate(now.getDate() + 7);

  const [
    activeApplications,
    weeklyInterviews,
    waitingInterviews,
    upcomingDeadlines,
    weeklyProposedSlots,
    weeklyScheduleEvents
  ] = await Promise.all([
    prisma.application.count({
      where: {
        userId,
        deletedAt: null,
        status: {
          in: [
            ApplicationStatus.APPLIED,
            ApplicationStatus.DOCUMENT_SCREENING,
            ApplicationStatus.INTERVIEWING,
            ApplicationStatus.OFFERED
          ]
        }
      }
    }),
    prisma.interview.findMany({
      where: {
        userId,
        deletedAt: null,
        status: InterviewStatus.CONFIRMED,
        confirmedStartAt: {
          gte: now,
          lte: weekEnd
        },
        selectionStage: {
          application: {
            deletedAt: null
          }
        }
      },
      include: {
        selectionStage: {
          include: {
            application: {
              include: {
                company: true
              }
            }
          }
        }
      },
      orderBy: {
        confirmedStartAt: "asc"
      }
    }),
    prisma.interview.findMany({
      where: {
        userId,
        deletedAt: null,
        status: InterviewStatus.WAITING_REPLY,
        selectionStage: {
          application: {
            deletedAt: null
          }
        }
      },
      include: {
        proposedSlots: {
          where: {
            deletedAt: null,
            status: ProposedSlotStatus.PENDING
          },
          orderBy: {
            startAt: "asc"
          }
        },
        selectionStage: {
          include: {
            application: {
              include: {
                company: true
              }
            }
          }
        }
      },
      orderBy: {
        updatedAt: "asc"
      },
      take: 8
    }),
    prisma.deadline.findMany({
      where: {
        userId,
        deletedAt: null,
        status: DeadlineStatus.OPEN,
        dueAt: {
          gte: now
        },
        application: {
          deletedAt: null
        }
      },
      include: {
        application: {
          include: {
            company: true
          }
        }
      },
      orderBy: {
        dueAt: "asc"
      },
      take: 8
    }),
    prisma.proposedSlot.findMany({
      where: {
        userId,
        deletedAt: null,
        status: ProposedSlotStatus.PENDING,
        startAt: {
          gte: now,
          lte: weekEnd
        },
        interview: {
          deletedAt: null,
          selectionStage: {
            application: {
              deletedAt: null
            }
          }
        }
      },
      include: {
        interview: {
          include: {
            selectionStage: {
              include: {
                application: {
                  include: {
                    company: true
                  }
                }
              }
            }
          }
        }
      },
      orderBy: {
        startAt: "asc"
      },
      take: 8
    }),
    prisma.scheduleEvent.findMany({
      where: {
        userId,
        deletedAt: null,
        startAt: {
          lte: weekEnd
        },
        endAt: {
          gte: now
        }
      },
      include: {
        application: {
          include: {
            company: true
          }
        }
      },
      orderBy: {
        startAt: "asc"
      },
      take: 8
    })
  ]);

  return {
    activeApplications,
    weeklyInterviews,
    waitingInterviews,
    upcomingDeadlines,
    weeklyProposedSlots,
    weeklyScheduleEvents
  };
}
