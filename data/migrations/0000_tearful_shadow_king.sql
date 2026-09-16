CREATE TABLE `games` (
	`game_id` text PRIMARY KEY NOT NULL,
	`season` integer NOT NULL,
	`week` integer NOT NULL,
	`game_type` text NOT NULL,
	`home_team` text NOT NULL,
	`away_team` text NOT NULL,
	`kickoff_utc` text,
	`home_score` integer,
	`away_score` integer,
	FOREIGN KEY (`home_team`) REFERENCES `teams`(`abbr`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`away_team`) REFERENCES `teams`(`abbr`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `games_season_week_idx` ON `games` (`season`,`week`);--> statement-breakpoint
CREATE INDEX `games_home_idx` ON `games` (`season`,`home_team`);--> statement-breakpoint
CREATE INDEX `games_away_idx` ON `games` (`season`,`away_team`);--> statement-breakpoint
CREATE TABLE `my_picks` (
	`season` integer NOT NULL,
	`week` integer NOT NULL,
	`team` text NOT NULL,
	`result` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	PRIMARY KEY(`season`, `week`),
	FOREIGN KEY (`team`) REFERENCES `teams`(`abbr`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `my_picks_season_team_idx` ON `my_picks` (`season`,`team`);--> statement-breakpoint
CREATE TABLE `odds_snapshots` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`game_id` text NOT NULL,
	`fetched_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`source` text DEFAULT 'odds-api' NOT NULL,
	`book_count` integer NOT NULL,
	`home_ml_median` real,
	`away_ml_median` real,
	`home_prob_devig` real,
	`away_prob_devig` real,
	`raw_json` text,
	FOREIGN KEY (`game_id`) REFERENCES `games`(`game_id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `odds_game_fetched_idx` ON `odds_snapshots` (`game_id`,`fetched_at`);--> statement-breakpoint
CREATE TABLE `settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `silver_projections` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`game_id` text NOT NULL,
	`fetched_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`home_prob` real,
	`away_prob` real,
	`tie_prob` real,
	`ingest_method` text NOT NULL,
	`source_note` text,
	FOREIGN KEY (`game_id`) REFERENCES `games`(`game_id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `silver_game_fetched_idx` ON `silver_projections` (`game_id`,`fetched_at`);--> statement-breakpoint
CREATE TABLE `team_ratings` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`team` text NOT NULL,
	`as_of` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`rating` real NOT NULL,
	FOREIGN KEY (`team`) REFERENCES `teams`(`abbr`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `ratings_team_asof_idx` ON `team_ratings` (`team`,`as_of`);--> statement-breakpoint
CREATE TABLE `teams` (
	`abbr` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`conference` text NOT NULL,
	`division` text NOT NULL
);
