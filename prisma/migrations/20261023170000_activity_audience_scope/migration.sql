-- Choose one audience mode instead of intersecting colleges with classes.
-- Existing class-based activities keep exactly the same student set because
-- their stored classes already belonged to the selected colleges.
CREATE TYPE "ActivityAudienceScope" AS ENUM ('ALL', 'COLLEGE', 'CLASS');

ALTER TABLE "Activity"
ADD COLUMN "audienceScope" "ActivityAudienceScope" NOT NULL DEFAULT 'COLLEGE';

UPDATE "Activity"
SET "audienceScope" = 'CLASS'
WHERE cardinality("audienceClasses") > 0;

UPDATE "Activity"
SET "audienceColleges" = ARRAY[]::text[]
WHERE "audienceScope" = 'CLASS';

UPDATE "Activity"
SET "audienceClasses" = ARRAY[]::text[]
WHERE "audienceScope" = 'COLLEGE';
