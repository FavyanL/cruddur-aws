from lib.db import pool, query_wrap_array

class MessageGroups:
  def run(cognito_user_id):
    model = {
      'errors': None,
      'data': None
    }

    if cognito_user_id == None or len(cognito_user_id) < 1:
      model['errors'] = ['user_handle_blank']
      return model

    # Find every distinct person this user has messaged with (either direction),
    # plus the time of the most recent message in each conversation.
    sql = query_wrap_array("""
      SELECT
        other_user.uuid,
        other_user.display_name,
        other_user.handle,
        MAX(messages.created_at) AS created_at
      FROM public.messages
      INNER JOIN public.users me ON me.cognito_user_id = %(cognito_user_id)s
      INNER JOIN public.users other_user
        ON (other_user.uuid = messages.user_sender_uuid AND messages.user_receiver_uuid = me.uuid)
        OR (other_user.uuid = messages.user_receiver_uuid AND messages.user_sender_uuid = me.uuid)
      WHERE other_user.uuid != me.uuid
      GROUP BY other_user.uuid, other_user.display_name, other_user.handle
      ORDER BY MAX(messages.created_at) DESC
    """)
    with pool.connection() as conn:
      with conn.cursor() as cur:
        cur.execute(sql, {'cognito_user_id': cognito_user_id})
        row = cur.fetchone()
        model['data'] = row[0] if row and row[0] else []
    return model