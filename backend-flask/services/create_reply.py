from lib.db import pool

class CreateReply:
  def run(message, user_handle, activity_uuid):
    model = {
      'errors': None,
      'data': None
    }

    if user_handle == None or len(user_handle) < 1:
      model['errors'] = ['user_handle_blank']

    if activity_uuid == None or len(activity_uuid) < 1:
      model['errors'] = ['activity_uuid_blank']

    if message == None or len(message) < 1:
      model['errors'] = ['message_blank']
    elif len(message) > 1024:
      model['errors'] = ['message_exceed_max_chars']

    if model['errors']:
      # return what we provided (without hitting the database)
      model['data'] = {
        'handle': user_handle,
        'message': message,
        'reply_to_activity_uuid': activity_uuid
      }
    else:
      reply_uuid = CreateReply.create_reply(user_handle, message, activity_uuid)
      model['data'] = CreateReply.query_reply(reply_uuid)
    return model

  # Insert a reply: a new activity that points at the original via reply_to_activity_uuid.
  # Returns the new reply's UUID.
  def create_reply(handle, message, reply_to_activity_uuid):
    sql = """
      INSERT INTO public.activities (
        user_uuid,
        message,
        reply_to_activity_uuid
      )
      VALUES (
        (SELECT uuid FROM public.users WHERE users.handle = %(handle)s LIMIT 1),
        %(message)s,
        %(reply_to_activity_uuid)s
      )
      RETURNING uuid;
    """
    with pool.connection() as conn:
      with conn.cursor() as cur:
        cur.execute(sql, {
          'handle': handle,
          'message': message,
          'reply_to_activity_uuid': reply_to_activity_uuid,
        })
        return cur.fetchone()[0]

  # Look up the just-created reply joined with the user's display info,
  # so the frontend has a complete record to render.
  def query_reply(reply_uuid):
    sql = """
      SELECT
        activities.uuid,
        users.display_name,
        users.handle,
        activities.message,
        activities.created_at,
        activities.reply_to_activity_uuid
      FROM public.activities
      INNER JOIN public.users ON activities.user_uuid = users.uuid
      WHERE activities.uuid = %(uuid)s;
    """
    with pool.connection() as conn:
      with conn.cursor() as cur:
        cur.execute(sql, {'uuid': reply_uuid})
        row = cur.fetchone()
        if row is None:
          return None
        return {
          'uuid': str(row[0]),
          'display_name': row[1],
          'handle': row[2],
          'message': row[3],
          'created_at': row[4].isoformat() if row[4] else None,
          'reply_to_activity_uuid': str(row[5]) if row[5] else None,
        }