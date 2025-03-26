CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

export CONNECTION_URL="postgresql://postgres:password@localhost:5432/cruddur"
gp en CONNECTION_URL="postgresql://postgres:password@localhost:5432/cruddur"

export PROD_CONNECTION_URL="postgresql://cruddurroot:goodDatabasePassword1@cruddur-db-instance.czugegm8acwr.us-east-1.rds.amazonaws.com:5432/cruddur"
gp env PROD_CONNECTION_URL="postgresql://cruddurroot:goodDatabasePassword1@cruddur-db-instance.czugegm8acwr.us-east-1.rds.amazonaws.com:5432/cruddur"

