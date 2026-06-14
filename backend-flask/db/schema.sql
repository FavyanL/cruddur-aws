CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

DROP TABLE IF EXISTS public.users;
DROP TABLE IF EXISTS public.activities;
DROP TABLE IF EXISTS public.messages;

CREATE TABLE public.users (
    uuid UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    display_name text,
    handle text,
    email text,
    cognito_user_id text,
    created_at TIMESTAMP default current_timestamp NOT NULL
);

CREATE TABLE public.activities (
    uuid UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    user_uuid UUID NOT NULL,
    message text NOT NULL,
    replies_count integer DEFAULT 0,
    repost_count integer DEFAULT 0,
    likes_count integer DEFAULT 0,
    reply_to_activity_uuid UUID,
    expires_at TIMESTAMP,
    created_at TIMESTAMP default current_timestamp NOT NULL
);

CREATE TABLE public.messages (
    uuid UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    user_sender_uuid UUID NOT NULL,
    user_receiver_uuid UUID NOT NULL,
    message text NOT NULL,
    created_at TIMESTAMP default current_timestamp NOT NULL
)



