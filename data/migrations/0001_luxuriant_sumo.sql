PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_odds_snapshots` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`game_id` text NOT NULL,
	`fetched_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`source` text NOT NULL,
	`book_count` integer NOT NULL,
	`home_ml_median` real,
	`away_ml_median` real,
	`home_prob_devig` real,
	`away_prob_devig` real,
	`raw_json` text,
	FOREIGN KEY (`game_id`) REFERENCES `games`(`game_id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_odds_snapshots`("id", "game_id", "fetched_at", "source", "book_count", "home_ml_median", "away_ml_median", "home_prob_devig", "away_prob_devig", "raw_json") SELECT "id", "game_id", "fetched_at", "source", "book_count", "home_ml_median", "away_ml_median", "home_prob_devig", "away_prob_devig", "raw_json" FROM `odds_snapshots`;--> statement-breakpoint
DROP TABLE `odds_snapshots`;--> statement-breakpoint
ALTER TABLE `__new_odds_snapshots` RENAME TO `odds_snapshots`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `odds_game_fetched_idx` ON `odds_snapshots` (`game_id`,`fetched_at`);