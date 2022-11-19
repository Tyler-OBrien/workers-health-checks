CREATE TABLE "health_checks" (
	"ID"	INTEGER NOT NULL,
	"Name"	TEXT NOT NULL,
	"Target"	TEXT NOT NULL,
	"Type"	TEXT NOT NULL,
	"Method"	TEXT,
	"ExpectedCodes"	TEXT,
	"ExpectedBodyContains"	TEXT,
	"CustomHeaders"	TEXT,
	"Status"	TEXT,
	"IsOnline"	INTEGER,
	"Active"	INTEGER NOT NULL DEFAULT 1,
	"LastCheck"	TEXT,
	PRIMARY KEY("ID" AUTOINCREMENT)
)